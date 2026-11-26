// 文件名：script.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// 🪶 低配模式物理求解器（独立文件：physics-lowspec.js）
import { ClothSolver, LOW_SPEC, SOLVER_PROFILES, SHAKE } from './physics-lowspec.js';

const selDecorColor = document.getElementById("selDecorColor");
const previewCanvas = document.getElementById("previewCanvas");
const canvasHost = document.querySelector(".canvasWrap");
const dropZone = document.getElementById("dropZone");
const ctx = previewCanvas.getContext("2d");

let CANVAS_W = 520;
let CANVAS_H = 520;

let loadedImage = null;
let imageTexture = null;
let imgAspect = 1;
let textureEnabled = true;
let lightEnabled = false;
let shadowEnabled = false;
let collisionEnabled = false;
let showGrid = false;

let outlineEnabled = false;
let outlineMesh = null;
let outlineMat = null;

let thicknessEnabled = false;
let thicknessMesh = null;
let thicknessMat = null;
let thicknessTexEnabled = false;

let flatShadingEnabled = false;
let clothOpacity = 1.0;
// 🦔 自碰撞半径的硬上限（单位：静止网格间距）。网格只跳过「自己 ±1 格」的邻居，
// 所以半径超过 ~2 格距时，平整布面上"隔一格"的正常邻居也会被当成重叠互相排斥，
// 整块布就会鼓成刺猬并疯狂抽搐。这里钳死，滑杆/常量填多大都不会炸。
const MAX_COLLISION_RADIUS_MUL = 1.4;
// 🪞 背面压暗强度（0~0.5）：布料是单层双面材质，翻过来看到的是同一张图，
// 视觉上分不清哪面朝你。用 gl_FrontFacing 把背面压暗一点就有"里外"了。
// ⚠️ 默认 0（关闭）：一旦布料因为"形状缩放因子"收缩成碗状，内壁全是背面，
//    压暗会让整块布看起来"发灰、像只显示了反面"。用户要的是两面看到同样的印花，
//    所以这里默认不区分正反。想要"里外感"时把它调回 0.10~0.15 即可。
let backShadeStrength = 0;
// 🪞 背面"收掉印花"强度（0~1，默认 1）：DoubleSide 下背面采样的是同一张图（左右镜像），
// 转过去或者布层相叠时，那层镜像印花会和正面叠成一重影。
// 这里在片元阶段把背面的颜色往"素布底色"收，正面完全不动。
let backHidePrint = 1.0;

let clothTransmission = 0.0;
let clothClearcoat = 0.0;
let clothIor = 1.5;
let clothThickness = 0.0;
let clothAttenuation = 0.0;
let clothAttenuationColor = "#ffffff";
let clothIridescence = 0.0;
let clothIridescenceIor = 1.3;
let clothSheen = 0.0;
let clothSheenColor = "#ffffff";
let clothSheenRoughness = 0.5;

let currentPbrType = "none";
let pbrTexSize = 20.0;
let pbrNormalScale = 1.0;
let pbrBaseNormalTexture = null;
let pbrNoiseNormalTexture = null;
let pbrAlphaTexture = null;
let pbrCustomNormalTexture = null;

let pbrNoiseEnabled = false;
let pbrNoiseStyle = "sand";
let pbrNoiseIntensity = 0.5;
let pbrNoiseSize = 4.0;

let activeShaderRef = null;
let bgEnvReflectEnabled = false;

let waterEnabled = false;
let clothWetness = 0.0;
let waterDropNormalTexture = null;
let dummyNormalTexture = null;
let evaporationSpeed = 0.002;
let shakeDryingFactor = 0.01;
let lastWetnessPercent = -1;
const waterRepeat = 10.0;
const waterMaxWetness = 0.05;
const shakeSpeedThreshold = 0.02;
const shakeSpeedRange = 0.03;

let waterDropSize = 1.0;
let waterDropDensity = 1.0;
let waterNormalIntensity = 1.0;
let waterTexRebuildTimer = null;

let blurEnabled = false;
let blurStrength = 0.4;
let blurNeedsReset = false;

let rtScene = null;
let rtVelocity = null;
let postScene = null;
let postCamera = null;
let postMat = null;

let velocityMesh = null;
let velocityScene = null;
let velocityMat = null;

let flipH = false;
let flipV = false;

// ===== 整体移动布料状态 =====
let clothMoveEnabled = false;
let isMovingCloth = false;
let lastClothMovePoint = null; 
const clothMovePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// ================= 旋转布料逻辑 =================
let prevRotX = 0;
let prevRotY = 0;
let prevRotZ = 0;

let pinStrokeList = [];
let currentPinStroke = [];
let currentPinStrokeWidth = 0.04;

// ============ 新增物理参数 ============
let plasticityEnabled = false;
let plasticityRate = 0.05;
let plasticityThreshold = 1.05;
let plasticityRecovery = 0;
let plasticityMax = 3.0;
let bendStiffness = 0.1;
let shearStiffness = 1.0;
let stiffX = 1.0;
let stiffY = 1.0;
let springDamping = 0.0;
let windSpatialFreq = 4.0;
let windZ = 0.0;
let gravityAngle = 0;
let groundCollisionEnabled = true;
let groundY = -1.5;
let groundFriction = 0.8;
let collisionFriction = 0.6;
let dragStrength = 0.4;
let airDampingExp = 0.2;
let maxVelocity = 0.20;
let velocityRetention = 1.0;

let drawMode = "pinstroke";
let eraserMode = "whole";
let isDrawing = false;
let isErasing = false;
let isCutting = false;
let editMode = true;
let isSimulating = true;
// 🪶 本次会话是否已经生成过布料（用于决定要不要继续显示第二步引导）
let hasGeneratedOnce = false;
let userTouchedMeshRes = false;   // 用户手动改过网格密度 → 生成时不再套预设值

let scene, camera, renderer;
let sceneHolder = null;   // 🎥 3D 镜头：旋转这个 group
let clothMesh = null;
let cloth = null;
let ambientLight = null;
let dirLight = null;
let groundMesh = null;
let groundShadowMesh = null;
let backWallMesh = null;
let raycaster, mouse;

let currentClothColor = "#9BCDEC";
let currentBgImageUrl = null;

const BOUND_SCALE = 0.5;
let zoom = 1;
let camX = 0, camY = 0, camZ = 3;

let touchDistStart = 0;
let isCanvasTouch = false;
let draggedParticles = [];
let multiTouchMap = new Map();
const dragOrigin = new THREE.Vector3();

let dragDepthMode = "auto";
let isTearingFrame = false;

let tearCanvas = null;
let tearCtx = null;
let tearTexture = null;

let customDecorGLTFScene = null;

let debrisList = [];
const MAX_DEBRIS = 300;

// ================= 装饰物系统 =================
let decorPlacementList = [];
let decorations = [];
// 模型旋转矫正配置 (单位：弧度)
// 如果发现哪个模型导入后朝向不对，就去改对应类型的 x, y, z 角度
// Math.PI / 2 代表 90度
const modelCorrections = {
    'sphere': { x: 0, y: 0, z: Math.PI },
    // 将 x 设为 -Math.PI / 2 (向前翻转90度立起来)
    'star': { x: -Math.PI / 2, y: 0, z: Math.PI }, 
    'heart': { x: -Math.PI / 2, y: 0, z: Math.PI }, 
    'cloud': { x: -Math.PI / 2, y: 0, z: Math.PI },
    'bow': { x: -Math.PI / 2, y: 0, z: Math.PI },
    'flower': { x: -Math.PI / 2, y: 0, z: Math.PI }, 
    'paw': { x: -Math.PI / 2, y: 0, z: Math.PI }, 
    'drop': { x: -Math.PI / 2, y: 0, z: Math.PI },
    'moon': { x: -Math.PI / 2, y: 0, z: Math.PI },
    'crown': { x: -Math.PI / 2, y: 0, z: Math.PI },
    'button': { x: -Math.PI / 2, y: 0, z: Math.PI }
};

// ================= 自定义模型预加载 =================
const customModelUrls = {
    'sphere': '小蓝珠.glb',
    'star': '星星.glb', // 你的截图里叫星星.glb
    'heart': '爱心.glb',
    'cloud': '云朵.glb',
    'bow': '蝴蝶结.glb',
    'flower': '雏菊.glb',
    'paw': '猫爪.glb',
    'drop': '水滴.glb',
    'moon': '月亮.glb',
    'crown': '皇冠.glb',
    'button': '纽扣.glb'
    // 樱桃保留原代码，不使用外部模型
    // candy 已废弃
};

const loadedModels = {};
let modelsLoadedCount = 0;
let modelsLoaded = false;
const gltfLoader = new GLTFLoader();

// 预加载所有模型
for (const [type, url] of Object.entries(customModelUrls)) {
    gltfLoader.load(url, (gltf) => {
        const model = gltf.scene;
        // 计算模型原始尺寸并统一缩放居中
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        // 目标基准大小 (对应你代码里的 baseSize = 0.06)
        const targetSize = 0.06 * 2.2; // 稍微放大一点，让模型更显眼
        const maxDim = Math.max(size.x, size.y, size.z);
        const autoScale = targetSize / maxDim;
        
        model.scale.setScalar(autoScale);
        // 居中模型
        model.position.sub(center.multiplyScalar(autoScale));
        
        // 保存计算好的半径用于碰撞/点击检测
        model.userData.baseRadius = targetSize * 0.5;

        // 开启阴影
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        
        loadedModels[type] = model;
        modelsLoadedCount++;
        if (modelsLoadedCount === Object.keys(customModelUrls).length) {
            modelsLoaded = true;
            console.log("所有自定义模型加载完毕");
        }
    }, undefined, (err) => {
        console.error(`模型加载失败: ${url}`, err);
        modelsLoadedCount++; // 失败了也计入，防止卡死
    });
}

let selectedDecorIndex = -1;
let draggingDecorIndex = -1;
const MAX_DECORATIONS = 200;
const decorColors = [
  "#FFD1DC", "#C6E2FF", "#FFF6CC", "#E2D5F8", "#D0F4DE", "#FFE0D0",
  "#F8C8DC", "#B9DDFF", "#E9E2F5", "#D9F5E9", "#FFEBD8", "#F2D7E7",
  "#FFE6F2", "#CCE7FF", "#FFF9CC", "#E8DEFF", "#D3F6E8", "#FFE8D6",
  "#F5D7E9", "#C8E8FF", "#F0E8FF", "#D7F4E2", "#FFE2CF", "#F7D8E2"
];


// --- 软萌材质【修复版，补全变量并修正错误】 ---
function createSoftMaterial(colorHex, type = 'plush') {
    const baseColor = new THREE.Color(colorHex);
    
    // 补全缺失的变量声明
    const map = null;
    const matProps = {
        color: baseColor,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0,
        alphaTest: 0.5
    };

    // 👈 修复：将原版错误的 matType 改为 type
    if (type === 'jelly') {
        return new THREE.MeshPhysicalMaterial({
            ...matProps,
            transparent: true,
            opacity: 0.8,             
            roughness: 0.1,            
            metalness: 0.0,
            clearcoat: 1.0,            
            clearcoatRoughness: 0.05,
            transmission: 0.0,         
            depthWrite: false,          
            depthTest: true,
            side: THREE.DoubleSide,    
            emissive: baseColor.clone().multiplyScalar(0.2)
        });
    } else if (type === 'metal') {
        return new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.25,
            metalness: 0.9,
            envMapIntensity: 1.2
        });
    } else if (type === 'holographic') {
        return new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.08,
            metalness: 0.75,
            emissive: baseColor,
            emissiveIntensity: 0.35
        });
    } else {
        // 默认毛绒/软糯硅胶
        return new THREE.MeshPhysicalMaterial({
            color: baseColor,
            roughness: 0.82,
            metalness: 0.0,
            clearcoat: 0.08,
            clearcoatRoughness: 0.75,
            sheen: 0.25,
            sheenColor: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.35)
        });
    }
}

// ========== 工具函数：生成【圆角平滑星形Shape】==========
function createRoundedStarShape(size, roundRadius = 0.18) {
    const shape = new THREE.Shape();
    const outerR = size;
    const innerR = size * 0.42;
    const points = [];
    const count = 5;
    for (let i = 0; i < count * 2; i++) {
        const angle = (i / (count * 2)) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 === 0 ? outerR : innerR;
        points.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
    }
    // 圆角插值，把尖角磨圆
    const curvePoints = [];
    for (let i = 0; i < points.length; i++) {
        const p0 = points[i];
        const p1 = points[(i + 1) % points.length];
        curvePoints.push(p0.clone().lerp(p1, roundRadius));
        curvePoints.push(p1.clone().lerp(p0, roundRadius));
    }
    shape.moveTo(curvePoints[0].x, curvePoints[0].y);
    for (let i = 1; i < curvePoints.length; i++) {
        shape.lineTo(curvePoints[i].x, curvePoints[i].y);
    }
    shape.closePath();
    return shape;
}

// ========== 圆润爱心Shape（手绘风格连续曲线爱心）==========
function createHeartShape(size) {
    const s = size;
    const shape = new THREE.Shape();
    shape.moveTo(0, s * 0.25);
    shape.bezierCurveTo(-s * 1.0, s * 1.1, -s * 1.2, -s * 0.3, 0, -s * 1.1);
    shape.bezierCurveTo(s * 1.2, -s * 0.3, s * 1.0, s * 1.1, 0, s * 0.25);
    shape.closePath();
    return shape;
}

// ========== 水滴Shape（顺滑泪滴，无圆锥硬尖）==========
function createDropShape(size) {
    const s = size;
    const shape = new THREE.Shape();
    shape.moveTo(0, s * 1.1);
    shape.bezierCurveTo(s * 0.7, s * 0.25, s * 0.7, -s * 0.7, 0, -s * 1.0);
    shape.bezierCurveTo(-s * 0.7, -s * 0.7, -s * 0.7, s * 0.25, 0, s * 1.1);
    shape.closePath();
    return shape;
}

// --- 核心模型生成器【重构版本，对齐手绘】 ---
function create3DDecorMesh(type, colorHex, matType, scale = 1.0) {
    const baseSize = 0.06;
        if (type === 'custom_upload' && customDecorSelect && customDecorSelect.value) {
        type = customDecorSelect.value;
    }
    // ======= 1. 樱桃（保留原版） =======
    else if (type === 'cherry') {
        const mat = createSoftMaterial(colorHex, matType);
        const mesh = new THREE.Group();
        const stemMat = createSoftMaterial("#88D49E", matType);
        const c1 = new THREE.Mesh(new THREE.SphereGeometry(baseSize * 0.44, 16, 16), mat);
        c1.position.set(-baseSize * 0.42, -baseSize * 0.22, 0);
        const c2 = new THREE.Mesh(new THREE.SphereGeometry(baseSize * 0.44, 16, 16), mat);
        c2.position.set(baseSize * 0.42, -baseSize * 0.22, 0);
        const stemGeo = new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3([
                new THREE.Vector3(-baseSize * 0.32, baseSize * 0.05, 0),
                new THREE.Vector3(0, baseSize * 0.28, 0),
                new THREE.Vector3(baseSize * 0.32, baseSize * 0.05, 0)
            ]),
            12, baseSize * 0.045, 8, false
        );
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.userData.isSpecial = true;
        mesh.add(c1, c2, stem);
        
        mesh.scale.setScalar(scale);
        // 2. 深度克隆材质，强制受光，并开启阴影
        // 2. 深度克隆材质，强制转换为受光材质，并开启阴影
        // 2. 深度克隆材质，根据 UI 选择赋予真实的物理质感
        mesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true; 
                child.receiveShadow = true;

                if (child.material) {
                    const processMaterial = (oldM) => {
                        // 继承原贴图
                        const map = oldM.map || null;
                        const baseColor = colorHex ? new THREE.Color(colorHex) : (oldM.color || new THREE.Color(0xffffff));
                        
                        // 根据面板选中的材质生成参数
                        let matProps = {
                            color: map ? new THREE.Color(0xffffff) : baseColor, // 有贴图就不覆盖颜色
                            map: map,
                            side: THREE.DoubleSide,
                            transparent: oldM.transparent,
                            opacity: oldM.opacity,
                            alphaTest: 0.5
                        };

                        if (matType === 'jelly') {
                            // 果冻透明（回归标准透明渲染，杜绝内部穿模）
                            return new THREE.MeshPhysicalMaterial({
                                ...matProps,
                                color: baseColor,
                                transmission: 0.0, 
                                roughness: 0.1,    
                                metalness: 0.0,
                                clearcoat: 1.0,    
                                clearcoatRoughness: 0.05,
                                transparent: true,
                                opacity: 0.65,     // 调低一点透明度，更具果冻感
                                depthWrite: false, // 不写深度，保证果冻之间互相透明
                                depthTest: true,   // 👈 必须恢复！让模型内部的零件正常遮挡
                                side: THREE.DoubleSide
                            });
                        } else if (matType === 'metal') {
                            // 金属高光
                            return new THREE.MeshStandardMaterial({
                                ...matProps,
                                roughness: 0.2,
                                metalness: 0.9,
                                envMapIntensity: 1.5
                            });
                        } else if (matType === 'holographic') {
                            // 镭射反光
                            return new THREE.MeshPhysicalMaterial({
                                ...matProps,
                                roughness: 0.1,
                                metalness: 0.5,
                                iridescence: 1.0, // 镭射膜效果
                                iridescenceIOR: 1.5
                            });
                        } else if (matType === 'plush') {
                            // 毛绒质感
                            return new THREE.MeshPhysicalMaterial({
                                ...matProps,
                                roughness: 1.0,
                                metalness: 0.0,
                                sheen: 1.0, // 绒毛边缘光
                                sheenRoughness: 0.5,
                                sheenColor: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5)
                            });
                        } else {
                            // plastic (哑光塑料) 默认
                            return new THREE.MeshStandardMaterial({
                                ...matProps,
                                roughness: 0.6,
                                metalness: 0.1
                            });
                        }
                    };

                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(processMaterial);
                    } else {
                        child.material = processMaterial(child.material);
                    }
                }
            }
        });
        mesh.userData.radius = baseSize * scale;
        return mesh;
    }

    // ======= 2. 其他模型（全部替换为导入的 GLB） =======
    if (loadedModels[type]) {
        const wrapper = new THREE.Group();
        const mesh = loadedModels[type].clone();
        
        const rot = modelCorrections[type] || { x: -Math.PI / 2, y: 0, z: 0 };
        mesh.rotation.set(rot.x, rot.y, rot.z);
        
        // 2. 深度克隆材质，根据 UI 选择赋予真实的物理质感
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                const processMaterial = (oldM) => {
                    // 继承原贴图，如果有贴图，颜色设为白色，防止底色污染
                    const map = oldM.map || null;
                    const baseColor = colorHex ? new THREE.Color(colorHex) : (oldM.color || new THREE.Color(0xffffff));
                    
                    let matProps = {
                        color: map ? new THREE.Color(0xffffff) : baseColor,
                        map: map,
                        side: THREE.DoubleSide, // 必须双面
                        transparent: oldM.transparent,
                        opacity: oldM.opacity,
                        alphaTest: 0.5 // 剔除透明区域
                    };

                    // 强制根据右侧面板的选项生成对应材质
                        if (matType === 'jelly') {
                            // 果冻透明（回归标准透明渲染，杜绝内部穿模）
                            return new THREE.MeshPhysicalMaterial({
                                ...matProps,
                                color: baseColor,
                                transmission: 0.0, 
                                roughness: 0.1,    
                                metalness: 0.0,
                                clearcoat: 1.0,    
                                clearcoatRoughness: 0.05,
                                transparent: true,
                                opacity: 0.65,     // 调低一点透明度，更具果冻感
                                depthWrite: false, // 不写深度，保证果冻之间互相透明
                                depthTest: true,   // 👈 必须恢复！让模型内部的零件正常遮挡
                                side: THREE.DoubleSide
                            });
                        } else if (matType === 'metal') {
                        return new THREE.MeshStandardMaterial({
                            ...matProps,
                            roughness: 0.2,
                            metalness: 0.9, // 金属反光
                            envMapIntensity: 1.5
                        });
                    } else if (matType === 'holographic') {
                        return new THREE.MeshPhysicalMaterial({
                            ...matProps,
                            roughness: 0.1,
                            metalness: 0.5,
                            iridescence: 1.0, // 镭射膜
                            iridescenceIOR: 1.5
                        });
                    } else if (matType === 'plush') {
                        return new THREE.MeshPhysicalMaterial({
                            ...matProps,
                            roughness: 1.0,
                            metalness: 0.0,
                            sheen: 1.0, // 毛绒边缘光
                            sheenRoughness: 0.5,
                            sheenColor: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5)
                        });
                    } else {
                        // 哑光塑料
                        return new THREE.MeshStandardMaterial({
                            ...matProps,
                            roughness: 0.6,
                            metalness: 0.1
                        });
                    }
                };

                if (Array.isArray(child.material)) {
                    child.material = child.material.map(processMaterial);
                } else {
                    child.material = processMaterial(child.material);
                }
            }
        });

        // 强制开启阴影
        mesh.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true; 
                child.receiveShadow = true;
            }
        });

        wrapper.add(mesh);
        wrapper.scale.multiplyScalar(scale);
        wrapper.userData.radius = (loadedModels[type].userData.baseRadius || baseSize) * scale;
        // 💡 强制渲染层级最高，防止被布料遮挡
        wrapper.renderOrder = 999; 
        mesh.traverse(child => {
            if (child.isMesh) child.renderOrder = 999;
        });

        return wrapper;
    }

    // ======= 3. 兜底：如果模型还没加载完或者加载失败 =======
    console.warn(`模型尚未加载完毕，使用占位球替代: ${type}`);
    const fallbackMat = createSoftMaterial(colorHex, 'plastic');
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(baseSize * 1.1, 32, 32), fallbackMat);
    mesh.scale.setScalar(scale);
    mesh.userData.radius = baseSize * scale;
    return mesh;
}



// 新物理参数的默认值（用于缺省字段兜底）
const physicsExtraDefaults = {
    plasticity: false, plRate: 0.05, plThreshold: 1.05, plRecovery: 0, plMax: 3.0,
    bend: 0.10, shear: 1.0, stiffX: 1.0, stiffY: 1.0, springDamp: 0.0,
    windSpatial: 4.0, windZ: 0.0,
    gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.8,
    collFric: 0.6, dragStr: 0.4, airExp: 0.2, maxVel: 0.20, velRet: 1.0,
    // 形状缩放因子：0 = 原始尺寸。必须在这里给默认值，
    // 否则预设没写 shape 时 applyPresetToSliders 会把 undefined 塞进滑杆 → 开局就是 NaN
    shape: 0
};

// ==============================================================
// 🧵 预设基准姿态（REST_POSE）
// 生成布料时给每类面料一个默认的悬挂角度，让面料特性一眼可辨
// （只是轻轻倾斜，不是翻转；数值是三个旋转滑块的初始角度）
// ==============================================================
const REST_POSE = {
    flag:         { x: 0,  y: 0,  z: 0 },
    // ⚠️ z 必须保持 0：绕 Z 轴旋转 = 在屏幕平面里整体转动，上边缘固定线会变斜，
    //    看上去就是布料歪掉了（草编席 18° / 帆布 12° / 牛仔 10° / 喷绘布 -10° 正是
    //    "部分预设生成出来是歪的"的直接来源）。x（前后倾）不会让上边缘变斜，
    //    只保留一个很小的角度来体现面料的垂坠差别。
    vinyl_banner: { x: -6, y: 0, z: 0 },
    awning:       { x: -6, y: 0, z: 0 },
    burlap:       { x: -3, y: 0, z: 0 },
    straw_mat:    { x: 0,  y: 0, z: 0 },
    canvas:       { x: -3, y: 0, z: 0 },
    denim:        { x: -3, y: 0, z: 0 },
    tulle:        { x: -4, y: 0, z: 0 },
    organza:      { x: -3, y: 0, z: 0 },
    lace:         { x: -3, y: 0, z: 0 },
    chiffon:      { x: -3, y: 0, z: 0 },
    silk:         { x: -2, y: 0, z: 0 },
    satin:        { x: -2, y: 0, z: 0 },
    taffeta:      { x: -2, y: 0, z: 0 },
    velvet:       { x: 0,  y: 0, z: 0 }
};

const physicsPresets = {
    // ==========================================================
    // ⚖️ 全量重写（v2）：把「算力」和「手感」两端的极端值收进统一区间，
    //    每块面料仍保留自己的性格（刚度 / 弯曲 / 剪切 / 质量 / 最大拉伸），
    //    但不再出现「某几个预设特别重」的情况。
    //
    //    算力上限（这三项相乘就是单帧成本）：
    //      meshRes    ≤ 32     （原来 spidersilk 40 / silk·chiffon·lace 36 / tulle·gauze 34）
    //      iterations ≤ 10     （原来 jelly 15 / metalsheet·clingfilm·rubber 12）
    //      hz         ≤ 110    （原来 metalsheet·jelly 120）
    //    最贵的预设从 ≈3.4× 棉布 降到 ≈1.9× 棉布，全部 65 个落在 0.3~1.9× 区间内。
    //
    //    手感上限（防止「硬得像纸板」，也降低自交锁死的概率）：
    //      stiffness ≤ 0.90    bend ≤ 0.70    shear ≤ 1.60
    //      mass      ≤ 120     damping ≤ 0.22  maxVel ≤ 0.45
    // ==========================================================
    // ==========================================================
    // 日常服装面料
    // ==========================================================
    cotton: {
        // 平纹棉：软硬适中，垂坠自然，拉扯后有轻微回弹
        stiffness: 0.5, maxStretch: 1.3, damping: 0.055, mass: 30, meshRes: 24, maxDrag: 0.6, iterations: 8, hz: 100,
        plasticity: false, plRate: 0.05, plThreshold: 1.05, plRecovery: 0.002, plMax: 1.6,
        bend: 0.25, shear: 1, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.6, dragStr: 0.4, airExp: 0.2, maxVel: 0.3, velRet: 1.0
    },
    washed_cotton: {
        // 水洗棉：比平纹更软、更有"穿旧了"的松弛感，形变更容易留下
        stiffness: 0.32, maxStretch: 1.42, damping: 0.065, mass: 35, meshRes: 24, maxDrag: 0.8, iterations: 8, hz: 100,
        plasticity: true, plRate: 0.09, plThreshold: 1.03, plRecovery: 0.003, plMax: 2.2,
        bend: 0.14, shear: 0.9, stiffX: 1, stiffY: 0.95, springDamp: 0.02,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.62, dragStr: 0.46, airExp: 0.2, maxVel: 0.32, velRet: 1.0
    },
    linen: {
        // 亚麻：清爽的骨架感，挺括但易碎褶
        stiffness: 0.72, maxStretch: 1.14, damping: 0.06, mass: 25, meshRes: 26, maxDrag: 0.5, iterations: 8, hz: 100,
        plasticity: true, plRate: 0.05, plThreshold: 1.04, plRecovery: 0.002, plMax: 1.8,
        bend: 0.38, shear: 1.25, stiffX: 1.3, stiffY: 1.05, springDamp: 0.03,
        windSpatial: 4.5, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.85,
        collFric: 0.68, dragStr: 0.38, airExp: 0.22, maxVel: 0.25, velRet: 1.0
    },
    wool: {
        // 羊毛：厚重、蓬松，下坠感明显
        stiffness: 0.62, maxStretch: 1.16, damping: 0.085, mass: 55, meshRes: 30, maxDrag: 0.5, iterations: 8, hz: 100,
        plasticity: false, plRate: 0.05, plThreshold: 1.05, plRecovery: 0.002, plMax: 2,
        bend: 0.42, shear: 1.3, stiffX: 1.2, stiffY: 1.1, springDamp: 0.04,
        windSpatial: 4.5, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.85,
        collFric: 0.7, dragStr: 0.33, airExp: 0.26, maxVel: 0.28, velRet: 1.0
    },
    velvet: {
        // 天鹅绒：密实、垂坠、几乎不回弹，压下去像绒毯
        stiffness: 0.55, maxStretch: 1.18, damping: 0.09, mass: 60, meshRes: 30, maxDrag: 0.6, iterations: 8, hz: 100,
        plasticity: true, plRate: 0.07, plThreshold: 1.06, plRecovery: 0.001, plMax: 2.2,
        bend: 0.22, shear: 0.95, stiffX: 1.1, stiffY: 1, springDamp: 0.05,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.82,
        collFric: 0.72, dragStr: 0.36, airExp: 0.24, maxVel: 0.26, velRet: 1.0
    },
    worsted_wool: {
        // 精纺毛呢：西装面料，紧密、挺括、几乎不飘
        stiffness: 0.82, maxStretch: 1.08, damping: 0.1, mass: 85, meshRes: 30, maxDrag: 0.3, iterations: 8, hz: 110,
        plasticity: false, plRate: 0.04, plThreshold: 1.03, plRecovery: 0.001, plMax: 1.6,
        bend: 0.58, shear: 1.55, stiffX: 1.35, stiffY: 1.2, springDamp: 0.06,
        windSpatial: 4.5, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.86,
        collFric: 0.7, dragStr: 0.28, airExp: 0.28, maxVel: 0.24, velRet: 1.0
    },
    tr_blend: {
        // TR 混纺：西装里布那种"有骨架但不硬"的手感
        stiffness: 0.6, maxStretch: 1.22, damping: 0.07, mass: 40, meshRes: 26, maxDrag: 0.5, iterations: 8, hz: 100,
        plasticity: false, plRate: 0.04, plThreshold: 1.08, plRecovery: 0.003, plMax: 1.8,
        bend: 0.3, shear: 1.15, stiffX: 1.1, stiffY: 1, springDamp: 0.03,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.62, dragStr: 0.4, airExp: 0.22, maxVel: 0.28, velRet: 1.0
    },
    polyester: {
        // 涤纶：顺滑、微弹、轻，抖一抖就平
        stiffness: 0.68, maxStretch: 1.28, damping: 0.055, mass: 25, meshRes: 28, maxDrag: 0.5, iterations: 8, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.1, plRecovery: 0.006, plMax: 1.5,
        bend: 0.32, shear: 1.3, stiffX: 1.2, stiffY: 1.15, springDamp: 0.03,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.78,
        collFric: 0.55, dragStr: 0.36, airExp: 0.22, maxVel: 0.3, velRet: 1.0
    },
    nylon: {
        // 尼龙：轻薄顺滑，表面滑溜（碰撞摩擦低），容易整体滑动
        stiffness: 0.64, maxStretch: 1.34, damping: 0.045, mass: 15, meshRes: 28, maxDrag: 0.7, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.12, plRecovery: 0.005, plMax: 1.6,
        bend: 0.2, shear: 1.05, stiffX: 1.1, stiffY: 1.05, springDamp: 0.02,
        windSpatial: 5.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.55,
        collFric: 0.28, dragStr: 0.44, airExp: 0.14, maxVel: 0.32, velRet: 1.0
    },
    terry: {
        // 毛巾布：厚重、抓地、毛圈吸水感，拖动时很"粘"
        stiffness: 0.6, maxStretch: 1.3, damping: 0.13, mass: 75, meshRes: 30, maxDrag: 0.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.05, plThreshold: 1.06, plRecovery: 0.002, plMax: 1.8,
        bend: 0.3, shear: 1.1, stiffX: 1.1, stiffY: 1.05, springDamp: 0.07,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.92,
        collFric: 0.88, dragStr: 0.32, airExp: 0.28, maxVel: 0.24, velRet: 1.0
    },
    felt: {
        // 毛毡：致密、几乎不回弹、压上去是"实心的"
        stiffness: 0.7, maxStretch: 1.12, damping: 0.16, mass: 60, meshRes: 26, maxDrag: 0.45, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.06, plThreshold: 1.04, plRecovery: 0.002, plMax: 1.6,
        bend: 0.62, shear: 1.4, stiffX: 1.15, stiffY: 1.1, springDamp: 0.15,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.82, dragStr: 0.28, airExp: 0.3, maxVel: 0.22, velRet: 1.0
    },
    corduroy: {
        // 灯芯绒：厚实有绒条，弯折时有明显的"骨位"
        stiffness: 0.56, maxStretch: 1.22, damping: 0.12, mass: 85, meshRes: 30, maxDrag: 0.45, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.04, plThreshold: 1.06, plRecovery: 0.002, plMax: 1.8,
        bend: 0.4, shear: 1.1, stiffX: 1.1, stiffY: 1.05, springDamp: 0.05,
        windSpatial: 4.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.88,
        collFric: 0.78, dragStr: 0.34, airExp: 0.26, maxVel: 0.24, velRet: 1.0
    },
    sherpa: {
        // 羊羔绒：蓬松、厚、阻尼大，抖起来像一团棉
        stiffness: 0.4, maxStretch: 1.38, damping: 0.17, mass: 70, meshRes: 28, maxDrag: 0.7, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.06, plThreshold: 1.05, plRecovery: 0.003, plMax: 2,
        bend: 0.2, shear: 0.9, stiffX: 1, stiffY: 1, springDamp: 0.07,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.86, dragStr: 0.4, airExp: 0.3, maxVel: 0.24, velRet: 1.0
    },
    chenille: {
        // 雪尼尔：极重、极密实，几乎像一块毯子
        stiffness: 0.52, maxStretch: 1.16, damping: 0.185, mass: 120, meshRes: 28, maxDrag: 0.4, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.03, plThreshold: 1.1, plRecovery: 0.001, plMax: 1.6,
        bend: 0.3, shear: 1.2, stiffX: 1.15, stiffY: 1.1, springDamp: 0.09,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.92,
        collFric: 0.84, dragStr: 0.26, airExp: 0.32, maxVel: 0.2, velRet: 1.0
    },
    mohair: {
        // 马海毛：毛感强、边缘蓬，滑动摩擦大
        stiffness: 0.5, maxStretch: 1.28, damping: 0.1, mass: 50, meshRes: 30, maxDrag: 0.55, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.05, plThreshold: 1.05, plRecovery: 0.002, plMax: 1.8,
        bend: 0.4, shear: 1.15, stiffX: 1.1, stiffY: 1.05, springDamp: 0.06,
        windSpatial: 4.4, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.86,
        collFric: 0.8, dragStr: 0.34, airExp: 0.24, maxVel: 0.26, velRet: 1.0
    },
    satin: {
        // 缎面：滑、垂、贴身，细褶多而流畅
        stiffness: 0.42, maxStretch: 1.38, damping: 0.05, mass: 45, meshRes: 30, maxDrag: 0.7, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.1, plRecovery: 0.004, plMax: 1.7,
        bend: 0.07, shear: 0.75, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 4.6, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.55,
        collFric: 0.38, dragStr: 0.46, airExp: 0.18, maxVel: 0.3, velRet: 1.0
    },
    taffeta: {
        // 塔夫绸：脆生生的"沙沙"感，褶皱锐利不易塌
        stiffness: 0.86, maxStretch: 1.06, damping: 0.06, mass: 30, meshRes: 30, maxDrag: 0.4, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.05, plRecovery: 0.002, plMax: 1.5,
        bend: 0.7, shear: 1.6, stiffX: 1.2, stiffY: 1.15, springDamp: 0.04,
        windSpatial: 4.8, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.55, dragStr: 0.34, airExp: 0.22, maxVel: 0.26, velRet: 1.0
    },
    organza: {
        // 欧根纱：薄而挺，像有骨头的纱，抖一下很有弹性
        stiffness: 0.76, maxStretch: 1.1, damping: 0.05, mass: 7, meshRes: 30, maxDrag: 0.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.1, plRecovery: 0.006, plMax: 1.4,
        bend: 0.5, shear: 1.45, stiffX: 1.15, stiffY: 1, springDamp: 0.03,
        windSpatial: 5.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.55,
        collFric: 0.35, dragStr: 0.46, airExp: 0.14, maxVel: 0.32, velRet: 1.0
    },
    tulle: {
        // 蓬蓬网纱：几乎没有重量，一吹就走，回弹慢
        stiffness: 0.32, maxStretch: 1.7, damping: 0.045, mass: 3.2, meshRes: 30, maxDrag: 1.4, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.01, plThreshold: 1.35, plRecovery: 0.015, plMax: 1.3,
        bend: 0.05, shear: 0.55, stiffX: 1, stiffY: 1, springDamp: 0.01,
        windSpatial: 6.2, windZ: 0.05, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.40,
        collFric: 0.3, dragStr: 0.55, airExp: 0.08, maxVel: 0.4, velRet: 1.0
    },
    lace: {
        // 蕾丝：轻薄柔软，边角细碎，垂下来像一层雾
        stiffness: 0.3, maxStretch: 1.55, damping: 0.04, mass: 4.5, meshRes: 30, maxDrag: 0.9, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.3, plRecovery: 0.01, plMax: 1.4,
        bend: 0.02, shear: 0.5, stiffX: 1, stiffY: 1, springDamp: 0.01,
        windSpatial: 5.8, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.45,
        collFric: 0.35, dragStr: 0.52, airExp: 0.1, maxVel: 0.36, velRet: 1.0
    },
    silk: {
        // 真丝：极轻极滑，垂坠如水，几乎不留褶
        stiffness: 0.3, maxStretch: 1.5, damping: 0.03, mass: 8, meshRes: 30, maxDrag: 0.8, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.15, plRecovery: 0.005, plMax: 1.5,
        bend: 0.05, shear: 0.6, stiffX: 1, stiffY: 1, springDamp: 0.01,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.50,
        collFric: 0.4, dragStr: 0.5, airExp: 0.15, maxVel: 0.35, velRet: 1.0
    },
    chiffon: {
        // 雪纺：比真丝更轻更透，飘起来没有阻力
        stiffness: 0.24, maxStretch: 1.4, damping: 0.02, mass: 4, meshRes: 30, maxDrag: 1.0, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.01, plThreshold: 1.2, plRecovery: 0.01, plMax: 1.3,
        bend: 0.02, shear: 0.5, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 6.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.40,
        collFric: 0.35, dragStr: 0.55, airExp: 0.1, maxVel: 0.4, velRet: 1.0
    },
    gauze: {
        // 医用纱布：极轻、透、软塌，几乎没有形状记忆
        stiffness: 0.36, maxStretch: 1.7, damping: 0.035, mass: 5, meshRes: 30, maxDrag: 1.1, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.25, plRecovery: 0.008, plMax: 1.4,
        bend: 0.03, shear: 0.6, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 6.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.50,
        collFric: 0.4, dragStr: 0.5, airExp: 0.1, maxVel: 0.36, velRet: 1.0
    },
    spidersilk: {
        // 蛛丝：几乎没重量，弹性极大，一松手就回弹
        stiffness: 0.22, maxStretch: 2.3, damping: 0.02, mass: 1.5, meshRes: 30, maxDrag: 2.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.01, plThreshold: 1.3, plRecovery: 0.01, plMax: 1.5,
        bend: 0, shear: 0.3, stiffX: 1, stiffY: 1, springDamp: 0.01,
        windSpatial: 7.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.30,
        collFric: 0.3, dragStr: 0.6, airExp: 0.05, maxVel: 0.45, velRet: 1.0
    },
    flag: {
        // 旗帜布：轻、软、极爱飘，风一来就是波浪
        stiffness: 0.34, maxStretch: 1.45, damping: 0.03, mass: 9, meshRes: 30, maxDrag: 0.9, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.2, plRecovery: 0.006, plMax: 1.5,
        bend: 0.09, shear: 0.7, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 5.6, windZ: 0.10, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.50,
        collFric: 0.35, dragStr: 0.5, airExp: 0.12, maxVel: 0.4, velRet: 1.0
    },
    spandex: {
        // 氨纶弹力布：能拉很长，松手"啪"地回弹，越拉越紧
        stiffness: 0.32, maxStretch: 2.55, damping: 0.045, mass: 16, meshRes: 30, maxDrag: 1.8, iterations: 9, hz: 100,
        plasticity: false, plRate: 0, plThreshold: 2, plRecovery: 0.03, plMax: 1.2,
        bend: 0.06, shear: 0.45, stiffX: 1, stiffY: 1, springDamp: 0.08,
        windSpatial: 4.4, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.60,
        collFric: 0.4, dragStr: 0.5, airExp: 0.14, maxVel: 0.34, velRet: 1.0
    },
    sportmesh: {
        // 速干网眼：轻、有弹性、回弹快，抖动干脆
        stiffness: 0.48, maxStretch: 1.55, damping: 0.05, mass: 12, meshRes: 30, maxDrag: 0.8, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.18, plRecovery: 0.01, plMax: 1.4,
        bend: 0.18, shear: 0.85, stiffX: 1, stiffY: 1, springDamp: 0.03,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.70,
        collFric: 0.45, dragStr: 0.45, airExp: 0.16, maxVel: 0.34, velRet: 1.0
    },

    // ==========================================================
    // 厚重 / 硬挺 / 工业面料
    // ==========================================================
    denim: {
        // 牛仔：沉、硬、拉扯阻力大，裤脚能立住
        stiffness: 0.8, maxStretch: 1.1, damping: 0.125, mass: 75, meshRes: 30, maxDrag: 0.4, iterations: 9, hz: 110,
        plasticity: false, plRate: 0.03, plThreshold: 1.05, plRecovery: 0.002, plMax: 1.8,
        bend: 0.55, shear: 1.3, stiffX: 1.2, stiffY: 1.1, springDamp: 0.06,
        windSpatial: 4.5, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.7, dragStr: 0.3, airExp: 0.28, maxVel: 0.25, velRet: 1.0
    },
    canvas: {
        // 帆布：最厚重的日常布料，像帐篷布
        stiffness: 0.9, maxStretch: 1.05, damping: 0.12, mass: 100, meshRes: 30, maxDrag: 0.3, iterations: 9, hz: 110,
        plasticity: false, plRate: 0.06, plThreshold: 1.03, plRecovery: 0.001, plMax: 2,
        bend: 0.7, shear: 1.4, stiffX: 1.3, stiffY: 1.3, springDamp: 0.08,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.72, dragStr: 0.28, airExp: 0.3, maxVel: 0.22, velRet: 1.0
    },
    vinyl_banner: {
        // 🖨 喷绘布：PVC 广告布，厚、硬、有一定"板感"，拉过头会留下永久形变
        stiffness: 0.72, maxStretch: 1.12, damping: 0.135, mass: 90, meshRes: 30, maxDrag: 0.35, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.05, plThreshold: 1.08, plRecovery: 0.001, plMax: 2.2,
        bend: 0.55, shear: 1.35, stiffX: 1.25, stiffY: 1.2, springDamp: 0.08,
        windSpatial: 4.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.72, dragStr: 0.3, airExp: 0.26, maxVel: 0.22, velRet: 1.0
    },
    awning: {
        // 遮阳篷布：亚克力涂层布，硬挺、耐候、风里不太飘
        stiffness: 0.74, maxStretch: 1.14, damping: 0.14, mass: 80, meshRes: 26, maxDrag: 0.3, iterations: 9, hz: 110,
        plasticity: false, plRate: 0.04, plThreshold: 1.05, plRecovery: 0.002, plMax: 1.8,
        bend: 0.5, shear: 1.3, stiffX: 1.2, stiffY: 1.15, springDamp: 0.09,
        windSpatial: 4.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.75, dragStr: 0.28, airExp: 0.28, maxVel: 0.22, velRet: 1.0
    },
    burlap: {
        // 麻袋布：粗糙、沉、几乎不回弹，越拖越"涩"
        stiffness: 0.82, maxStretch: 1.1, damping: 0.17, mass: 110, meshRes: 26, maxDrag: 0.3, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.08, plThreshold: 1.06, plRecovery: 0.001, plMax: 2,
        bend: 0.6, shear: 1.5, stiffX: 1.2, stiffY: 1.15, springDamp: 0.12,
        windSpatial: 3.8, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.9, dragStr: 0.25, airExp: 0.32, maxVel: 0.2, velRet: 1.0
    },
    straw_mat: {
        // 草编席：硬、脆、几乎不弯，弯了会留折痕
        stiffness: 0.9, maxStretch: 1.03, damping: 0.11, mass: 65, meshRes: 22, maxDrag: 0.2, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.03, plThreshold: 1.02, plRecovery: 0, plMax: 1.5,
        bend: 0.7, shear: 1.6, stiffX: 1.25, stiffY: 1.25, springDamp: 0.1,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.8, dragStr: 0.2, airExp: 0.3, maxVel: 0.2, velRet: 1.0
    },
    leather: {
        // 皮革：重、韧、拉扯后不会完全回到原样
        stiffness: 0.85, maxStretch: 1.15, damping: 0.155, mass: 90, meshRes: 30, maxDrag: 0.4, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.05, plThreshold: 1.1, plRecovery: 0.001, plMax: 2.5,
        bend: 0.6, shear: 1.4, stiffX: 1.3, stiffY: 1.3, springDamp: 0.1,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.75, dragStr: 0.28, airExp: 0.3, maxVel: 0.25, velRet: 1.0
    },
    suede: {
        // 麂皮：厚绒面，比皮革更软，形变留得住
        stiffness: 0.78, maxStretch: 1.12, damping: 0.19, mass: 100, meshRes: 28, maxDrag: 0.35, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.06, plThreshold: 1.09, plRecovery: 0.001, plMax: 2.4,
        bend: 0.5, shear: 1.3, stiffX: 1.2, stiffY: 1.2, springDamp: 0.12,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.93,
        collFric: 0.8, dragStr: 0.26, airExp: 0.32, maxVel: 0.22, velRet: 1.0
    },
    metal: {
        // 金属丝网：重且硬，网格之间会"较劲"
        stiffness: 0.9, maxStretch: 1.1, damping: 0.2, mass: 120, meshRes: 28, maxDrag: 0.2, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.05, plThreshold: 1.1, plRecovery: 0.001, plMax: 1.5,
        bend: 0.65, shear: 1.6, stiffX: 1.2, stiffY: 1.2, springDamp: 0.15,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.8, dragStr: 0.25, airExp: 0.35, maxVel: 0.2, velRet: 1.0
    },
    metalsheet: {
        // 铁皮：极重、几乎不可拉伸，砸下去"哐"一声
        stiffness: 0.9, maxStretch: 1.04, damping: 0.22, mass: 120, meshRes: 20, maxDrag: 0.2, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.03, plThreshold: 1.06, plRecovery: 0, plMax: 2.5,
        bend: 0.7, shear: 1.6, stiffX: 1.35, stiffY: 1.35, springDamp: 0.2,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.8, dragStr: 0.22, airExp: 0.35, maxVel: 0.18, velRet: 1.0
    },

    // ==========================================================
    // 橡胶 / 弹性体 / 特殊手感
    // ==========================================================
    rubber: {
        // 橡胶：重，但能拉长好几倍，回弹"嗡"地一下
        stiffness: 0.2, maxStretch: 2.8, damping: 0.08, mass: 60, meshRes: 24, maxDrag: 2.0, iterations: 9, hz: 110,
        plasticity: false, plRate: 0, plThreshold: 2, plRecovery: 0.05, plMax: 1.1,
        bend: 0.1, shear: 0.4, stiffX: 1, stiffY: 1, springDamp: 0.15,
        windSpatial: 3.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.5, dragStr: 0.5, airExp: 0.15, maxVel: 0.4, velRet: 1.0
    },
    silicone: {
        // 硅胶布：又重又有肉感，按下去会陷、会回
        stiffness: 0.9, maxStretch: 1.1, damping: 0.18, mass: 110, meshRes: 28, maxDrag: 1.2, iterations: 9, hz: 110,
        plasticity: false, plRate: 0, plThreshold: 2, plRecovery: 0.04, plMax: 1.2,
        bend: 0.25, shear: 0.6, stiffX: 1, stiffY: 1, springDamp: 0.2,
        windSpatial: 3.5, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.55, dragStr: 0.45, airExp: 0.25, maxVel: 0.22, velRet: 1.0
    },
    neoprene: {
        // 潜水料：厚、弹、有支撑，弯下去会自己顶回来
        stiffness: 0.45, maxStretch: 1.8, damping: 0.12, mass: 70, meshRes: 24, maxDrag: 1.0, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.5, plRecovery: 0.02, plMax: 1.5,
        bend: 0.5, shear: 0.8, stiffX: 1, stiffY: 1, springDamp: 0.15,
        windSpatial: 3.5, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.6, dragStr: 0.45, airExp: 0.22, maxVel: 0.28, velRet: 1.0
    },
    jelly: {
        // 果冻：重、滑、duang duang 地晃，一碰就颤
        stiffness: 0.15, maxStretch: 2.5, damping: 0.05, mass: 100, meshRes: 24, maxDrag: 2.5, iterations: 9, hz: 110,
        plasticity: false, plRate: 0, plThreshold: 2, plRecovery: 0.05, plMax: 1.1,
        bend: 0.05, shear: 0.3, stiffX: 1, stiffY: 1, springDamp: 0.15,
        windSpatial: 3.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.50,
        collFric: 0.45, dragStr: 0.55, airExp: 0.1, maxVel: 0.35, velRet: 1.0
    },
    foam: {
        // EVA 泡棉：极轻、不拉伸、弯不塌，捏一下有气孔感
        stiffness: 0.88, maxStretch: 1.04, damping: 0.09, mass: 10, meshRes: 24, maxDrag: 0.5, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.16, plThreshold: 1.02, plRecovery: 0.002, plMax: 2,
        bend: 0.7, shear: 1.6, stiffX: 1.1, stiffY: 1.1, springDamp: 0.14,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.70,
        collFric: 0.6, dragStr: 0.35, airExp: 0.18, maxVel: 0.24, velRet: 1.0
    },
    paper: {
        // 纸张：轻、脆、一搓就皱，皱痕几乎不可逆
        stiffness: 0.7, maxStretch: 1.03, damping: 0.11, mass: 6, meshRes: 16, maxDrag: 0.2, iterations: 6, hz: 80,
        plasticity: true, plRate: 0.25, plThreshold: 1.01, plRecovery: 0, plMax: 2,
        bend: 0.7, shear: 1.6, stiffX: 1.3, stiffY: 1, springDamp: 0.1,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.70,
        collFric: 0.5, dragStr: 0.3, airExp: 0.15, maxVel: 0.25, velRet: 1.0
    },
    plastic: {
        // 塑料薄膜：极轻、微弹、噼里啪啦地飘
        stiffness: 0.4, maxStretch: 1.6, damping: 0.02, mass: 8, meshRes: 28, maxDrag: 1.5, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.12, plThreshold: 1.1, plRecovery: 0.001, plMax: 2.5,
        bend: 0.15, shear: 0.4, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.60,
        collFric: 0.4, dragStr: 0.5, airExp: 0.12, maxVel: 0.35, velRet: 1.0
    },
    bubble_wrap: {
        // 气泡膜：轻、脆、一按一个坑，坑会记住
        stiffness: 0.52, maxStretch: 1.28, damping: 0.09, mass: 7, meshRes: 28, maxDrag: 0.8, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.2, plThreshold: 1.04, plRecovery: 0, plMax: 2.5,
        bend: 0.3, shear: 1.1, stiffX: 1, stiffY: 1, springDamp: 0.03,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.60,
        collFric: 0.45, dragStr: 0.4, airExp: 0.12, maxVel: 0.3, velRet: 1.0
    },
    clingfilm: {
        // 保鲜膜：轻、极滑、自己粘自己（自碰撞摩擦拉满）
        stiffness: 0.62, maxStretch: 2.1, damping: 0.045, mass: 4, meshRes: 30, maxDrag: 1.8, iterations: 9, hz: 110,
        plasticity: false, plRate: 0.03, plThreshold: 1.8, plRecovery: 0.005, plMax: 2,
        bend: 0.1, shear: 0.5, stiffX: 1, stiffY: 1, springDamp: 0.03,
        windSpatial: 6.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.95, dragStr: 0.5, airExp: 0.1, maxVel: 0.3, velRet: 1.0
    },
    // ==========================================================
    // 与新增 PBR 法线贴图配套的面料
    // ==========================================================
    oxford: {
        // 涂层牛津布：厚实平纹 + PU 涂层，挺而不僵
        stiffness: 0.68, maxStretch: 1.18, damping: 0.1, mass: 55, meshRes: 28, maxDrag: 0.4, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.04, plThreshold: 1.06, plRecovery: 0.002, plMax: 1.8,
        bend: 0.45, shear: 1.25, stiffX: 1.15, stiffY: 1.1, springDamp: 0.05,
        windSpatial: 4.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.88,
        collFric: 0.7, dragStr: 0.34, airExp: 0.26, maxVel: 0.24, velRet: 1.0
    },
    duck_canvas: {
        // 防水帆布：蜡感涂层，比普通帆布更硬更沉
        stiffness: 0.9, maxStretch: 1.06, damping: 0.15, mass: 120, meshRes: 26, maxDrag: 0.3, iterations: 9, hz: 110,
        plasticity: false, plRate: 0.03, plThreshold: 1.03, plRecovery: 0.001, plMax: 1.6,
        bend: 0.7, shear: 1.5, stiffX: 1.3, stiffY: 1.3, springDamp: 0.1,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.78, dragStr: 0.26, airExp: 0.32, maxVel: 0.2, velRet: 1.0
    },
    sateen: {
        // 贡缎：棉缎光泽面，滑、垂、几乎不留褶
        stiffness: 0.45, maxStretch: 1.32, damping: 0.06, mass: 50, meshRes: 30, maxDrag: 0.7, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.12, plRecovery: 0.005, plMax: 1.6,
        bend: 0.1, shear: 0.8, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 4.6, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.60,
        collFric: 0.45, dragStr: 0.48, airExp: 0.18, maxVel: 0.3, velRet: 1.0
    },
    jersey: {
        // 平针针织：软、弹、贴手，拉扯后形变会留一点
        stiffness: 0.4, maxStretch: 1.45, damping: 0.07, mass: 35, meshRes: 30, maxDrag: 0.7, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.07, plThreshold: 1.05, plRecovery: 0.004, plMax: 1.7,
        bend: 0.12, shear: 0.75, stiffX: 1, stiffY: 0.95, springDamp: 0.03,
        windSpatial: 4.8, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.70,
        collFric: 0.55, dragStr: 0.46, airExp: 0.2, maxVel: 0.32, velRet: 1.0
    },
    rib_knit: {
        // 罗纹针织：竖向条纹，横向弹性大、纵向挺
        stiffness: 0.5, maxStretch: 1.35, damping: 0.08, mass: 40, meshRes: 30, maxDrag: 0.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.05, plThreshold: 1.08, plRecovery: 0.004, plMax: 1.6,
        bend: 0.25, shear: 0.9, stiffX: 1.2, stiffY: 0.9, springDamp: 0.04,
        windSpatial: 4.4, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.75,
        collFric: 0.6, dragStr: 0.42, airExp: 0.22, maxVel: 0.28, velRet: 1.0
    },
    plisse: {
        // 百褶布：折痕处很硬，压下去会自己立住
        stiffness: 0.75, maxStretch: 1.08, damping: 0.08, mass: 40, meshRes: 30, maxDrag: 0.4, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.04, plThreshold: 1.04, plRecovery: 0, plMax: 1.8,
        bend: 0.7, shear: 1.6, stiffX: 1.15, stiffY: 1, springDamp: 0.06,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.85,
        collFric: 0.68, dragStr: 0.3, airExp: 0.24, maxVel: 0.24, velRet: 1.0
    },
    tweed: {
        // 粗花呢：粗、硬、重，几乎不随风摆
        stiffness: 0.72, maxStretch: 1.12, damping: 0.17, mass: 95, meshRes: 28, maxDrag: 0.4, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.04, plThreshold: 1.05, plRecovery: 0.002, plMax: 1.7,
        bend: 0.55, shear: 1.35, stiffX: 1.1, stiffY: 1.1, springDamp: 0.09,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.92,
        collFric: 0.8, dragStr: 0.28, airExp: 0.3, maxVel: 0.22, velRet: 1.0
    },
    bamboo_mat: {
        // 竹席：硬、脆，弯折会留下痕迹
        stiffness: 0.9, maxStretch: 1.03, damping: 0.12, mass: 70, meshRes: 24, maxDrag: 0.2, iterations: 9, hz: 110,
        plasticity: true, plRate: 0.03, plThreshold: 1.02, plRecovery: 0, plMax: 1.5,
        bend: 0.7, shear: 1.6, stiffX: 1.3, stiffY: 1.3, springDamp: 0.1,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.8, dragStr: 0.22, airExp: 0.3, maxVel: 0.2, velRet: 1.0
    },
    tinfoil: {
        // 锡箔：极轻、脆、一揉全是细褶，且回不去
        stiffness: 0.6, maxStretch: 1.15, damping: 0.05, mass: 4, meshRes: 26, maxDrag: 0.5, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.3, plThreshold: 1.01, plRecovery: 0, plMax: 2.4,
        bend: 0.35, shear: 0.9, stiffX: 1, stiffY: 1, springDamp: 0.03,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.60,
        collFric: 0.4, dragStr: 0.5, airExp: 0.1, maxVel: 0.3, velRet: 1.0
    },
    cork: {
        // 软木：厚、弹不起多少，弯折就裂
        stiffness: 0.85, maxStretch: 1.05, damping: 0.2, mass: 45, meshRes: 24, maxDrag: 0.3, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.1, plThreshold: 1.02, plRecovery: 0.001, plMax: 1.6,
        bend: 0.7, shear: 1.6, stiffX: 1.2, stiffY: 1.2, springDamp: 0.12,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.95,
        collFric: 0.85, dragStr: 0.24, airExp: 0.3, maxVel: 0.18, velRet: 1.0
    },
    devore: {
        // 烧花绒：绒面被烧出花纹，轻、软、半透
        stiffness: 0.35, maxStretch: 1.5, damping: 0.06, mass: 18, meshRes: 30, maxDrag: 0.9, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.15, plRecovery: 0.006, plMax: 1.5,
        bend: 0.06, shear: 0.6, stiffX: 1, stiffY: 1, springDamp: 0.02,
        windSpatial: 5.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.55,
        collFric: 0.42, dragStr: 0.5, airExp: 0.15, maxVel: 0.32, velRet: 1.0
    },
    perforated: {
        // 打孔膜：有孔洞的硬质薄膜，拉伸时会从孔边起皱
        stiffness: 0.8, maxStretch: 1.12, damping: 0.07, mass: 35, meshRes: 30, maxDrag: 0.5, iterations: 9, hz: 100,
        plasticity: true, plRate: 0.08, plThreshold: 1.06, plRecovery: 0.002, plMax: 1.8,
        bend: 0.6, shear: 1.5, stiffX: 1.2, stiffY: 1.2, springDamp: 0.05,
        windSpatial: 4.4, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.85,
        collFric: 0.65, dragStr: 0.32, airExp: 0.2, maxVel: 0.26, velRet: 1.0
    },
    mesh_banner: {
        // 网格喷绘布：粗织网格，轻、韧、透一点风
        stiffness: 0.65, maxStretch: 1.3, damping: 0.08, mass: 30, meshRes: 28, maxDrag: 0.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.1, plRecovery: 0.004, plMax: 1.6,
        bend: 0.3, shear: 1.2, stiffX: 1.1, stiffY: 1.05, springDamp: 0.04,
        windSpatial: 4.6, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.80,
        collFric: 0.6, dragStr: 0.4, airExp: 0.18, maxVel: 0.28, velRet: 1.0
    },
    habotai: {
        // 电力纺：极薄的平纹真丝，垂坠如水
        stiffness: 0.3, maxStretch: 1.48, damping: 0.03, mass: 6, meshRes: 30, maxDrag: 1.0, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.02, plThreshold: 1.18, plRecovery: 0.008, plMax: 1.4,
        bend: 0.04, shear: 0.55, stiffX: 1, stiffY: 1, springDamp: 0.01,
        windSpatial: 5.4, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.45,
        collFric: 0.35, dragStr: 0.52, airExp: 0.12, maxVel: 0.36, velRet: 1.0
    },
    fishnet: {
        // 渔网：大网眼 + 高弹性，一拉一整片变形
        stiffness: 0.38, maxStretch: 1.9, damping: 0.035, mass: 6, meshRes: 28, maxDrag: 1.2, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.01, plThreshold: 1.4, plRecovery: 0.02, plMax: 1.4,
        bend: 0.1, shear: 0.5, stiffX: 1, stiffY: 1, springDamp: 0.03,
        windSpatial: 6.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.55,
        collFric: 0.35, dragStr: 0.55, airExp: 0.12, maxVel: 0.36, velRet: 1.0
    },
    glitter_seqn: {
        // 亮片布：亮片面硬、重，弯折时有"颗粒感"
        stiffness: 0.78, maxStretch: 1.1, damping: 0.15, mass: 85, meshRes: 26, maxDrag: 0.35, iterations: 9, hz: 110,
        plasticity: false, plRate: 0.03, plThreshold: 1.04, plRecovery: 0.001, plMax: 1.5,
        bend: 0.6, shear: 1.5, stiffX: 1.15, stiffY: 1.15, springDamp: 0.1,
        windSpatial: 4.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.90,
        collFric: 0.78, dragStr: 0.26, airExp: 0.28, maxVel: 0.2, velRet: 1.0
    },
    fleece: {
        // 抓绒：轻、蓬、阻尼大，抖起来像一团棉花
        stiffness: 0.4, maxStretch: 1.4, damping: 0.16, mass: 30, meshRes: 28, maxDrag: 0.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.05, plThreshold: 1.06, plRecovery: 0.003, plMax: 1.8,
        bend: 0.18, shear: 0.85, stiffX: 1, stiffY: 1, springDamp: 0.06,
        windSpatial: 4.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.88,
        collFric: 0.82, dragStr: 0.38, airExp: 0.3, maxVel: 0.24, velRet: 1.0
    },
    hook: {
        // 钩编：镂空、有弹性，网眼间会互相拉扯
        stiffness: 0.5, maxStretch: 1.55, damping: 0.06, mass: 20, meshRes: 28, maxDrag: 1.0, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.03, plThreshold: 1.2, plRecovery: 0.008, plMax: 1.5,
        bend: 0.12, shear: 0.7, stiffX: 1, stiffY: 1, springDamp: 0.03,
        windSpatial: 5.0, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.60,
        collFric: 0.42, dragStr: 0.5, airExp: 0.15, maxVel: 0.32, velRet: 1.0
    },
    cable_knit: {
        // 绞花针织：厚、密、抗弯强，抖起来是一整片
        stiffness: 0.62, maxStretch: 1.25, damping: 0.13, mass: 60, meshRes: 30, maxDrag: 0.6, iterations: 9, hz: 100,
        plasticity: false, plRate: 0.04, plThreshold: 1.07, plRecovery: 0.003, plMax: 1.7,
        bend: 0.55, shear: 1.1, stiffX: 1.1, stiffY: 1.1, springDamp: 0.07,
        windSpatial: 4.2, windZ: 0.0, gravAngle: 0, ground: true, groundY: -1.5, groundFric: 0.88,
        collFric: 0.72, dragStr: 0.34, airExp: 0.25, maxVel: 0.24, velRet: 1.0
    }

};

const materialPresets = {
    // 每一项：light 光照强度 / rough 粗糙度 / metal 金属度 / flat 面片
    //        opacity 透明度 / trans 透射 / clear 清漆 / ior 折射率
    //        thick 厚度 / atten 衰减距离 / attenCol 衰减颜色
    //        irid 虹彩 / iridIor 虹彩折射率 / sheen 绒面光泽 / sheenCol 光泽色 / sheenRough 光泽粗糙
    // ----------------------------------------------------------
    // 日常布料：以 sheen / 高粗糙度为主，几乎没有金属感
    // ----------------------------------------------------------
    custom:     { light: 0.45, rough: 0.75, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0, sheenCol: "#ffffff", sheenRough: 0.5 },
    default:    { light: 0.45, rough: 0.80, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.05, sheenCol: "#ffffff", sheenRough: 0.6 },
    cotton:     { light: 0.50, rough: 0.95, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.35, sheenCol: "#ffffff", sheenRough: 0.85 },
    washed_cotton: { light: 0.50, rough: 0.92, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.30, sheenCol: "#ffffff", sheenRough: 0.90 },
    linen:      { light: 0.45, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.22, sheenCol: "#f6efe4", sheenRough: 0.95 },
    wool:       { light: 0.40, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.55, sheenCol: "#ffffff", sheenRough: 0.92 },
    velvet:     { light: 0.35, rough: 0.98, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 1.00, sheenCol: "#ffe9ef", sheenRough: 0.95 },
    worsted_wool: { light: 0.40, rough: 0.96, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.45, sheenCol: "#ffffff", sheenRough: 0.85 },
    tr_blend:   { light: 0.50, rough: 0.85, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.20, sheenCol: "#ffffff", sheenRough: 0.70 },
    polyester:  { light: 0.58, rough: 0.44, metal: 0.04, flat: false, opacity: 1.0, trans: 0, clear: 0.06, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.34, sheenCol: "#ffffff", sheenRough: 0.62 },
    nylon:      { light: 0.60, rough: 0.40, metal: 0.02, flat: false, opacity: 1.0, trans: 0, clear: 0.08, ior: 1.53, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.28, sheenCol: "#ffffff", sheenRough: 0.58 },
    terry:      { light: 0.45, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.70, sheenCol: "#ffffff", sheenRough: 0.98 },
    felt:       { light: 0.40, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.35, sheenCol: "#ffffff", sheenRough: 0.98 },
    corduroy:   { light: 0.40, rough: 0.97, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.60, sheenCol: "#ffffff", sheenRough: 0.90 },
    sherpa:     { light: 0.45, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.85, sheenCol: "#ffffff", sheenRough: 0.95 },
    chenille:   { light: 0.35, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.75, sheenCol: "#ffffff", sheenRough: 0.96 },
    mohair:     { light: 0.42, rough: 0.95, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.90, sheenCol: "#ffffff", sheenRough: 0.80 },
    satin:      { light: 0.66, rough: 0.30, metal: 0.05, flat: false, opacity: 1.0, trans: 0, clear: 0.05, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.62, sheenCol: "#fff2f5", sheenRough: 0.38 },
    taffeta:    { light: 0.58, rough: 0.40, metal: 0.03, flat: false, opacity: 1.0, trans: 0, clear: 0.05, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.46, sheenCol: "#ffffff", sheenRough: 0.46 },
    organza:    { light: 0.65, rough: 0.35, metal: 0.10, flat: false, opacity: 0.45, trans: 0.25, clear: 0.00, ior: 1.50, thick: 0.10, atten: 1.5, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.35, sheenCol: "#ffffff", sheenRough: 0.40 },
    tulle:      { light: 0.70, rough: 0.50, metal: 0.05, flat: false, opacity: 0.30, trans: 0.30, clear: 0.10, ior: 1.50, thick: 0.05, atten: 1.0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.30, sheenCol: "#ffffff", sheenRough: 0.60 },
    lace:       { light: 0.60, rough: 0.60, metal: 0.00, flat: false, opacity: 0.50, trans: 0.20, clear: 0.10, ior: 1.50, thick: 0.05, atten: 1.0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.40, sheenCol: "#ffffff", sheenRough: 0.70 },
    silk:       { light: 0.62, rough: 0.28, metal: 0.08, flat: false, opacity: 0.92, trans: 0.03, clear: 0.08, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.80, sheenCol: "#fff4f6", sheenRough: 0.42 },
    chiffon:    { light: 0.70, rough: 0.20, metal: 0.20, flat: false, opacity: 0.50, trans: 0.40, clear: 0.05, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.60, sheenCol: "#ffffff", sheenRough: 0.40 },
    gauze:      { light: 0.60, rough: 0.85, metal: 0.10, flat: false, opacity: 0.35, trans: 0.50, clear: 0.00, ior: 1.50, thick: 0.10, atten: 2.0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.30, sheenCol: "#ffffff", sheenRough: 0.85 },
    flag:       { light: 0.60, rough: 0.55, metal: 0.05, flat: false, opacity: 1.0, trans: 0, clear: 0.10, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.30, sheenCol: "#ffffff", sheenRough: 0.55 },
    spandex:    { light: 0.55, rough: 0.45, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.20, sheenCol: "#ffffff", sheenRough: 0.50 },
    sportmesh:  { light: 0.60, rough: 0.60, metal: 0.05, flat: false, opacity: 1.0, trans: 0, clear: 0.10, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.20, sheenCol: "#ffffff", sheenRough: 0.60 },
    denim:      { light: 0.45, rough: 0.90, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.20, sheenCol: "#ffffff", sheenRough: 0.80 },
    canvas:     { light: 0.45, rough: 0.96, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.15, sheenCol: "#ffffff", sheenRough: 0.90 },
    burlap:     { light: 0.40, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.20, sheenCol: "#f1e5cf", sheenRough: 1.00 },
    tie_dye:    { light: 0.55, rough: 0.75, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.20, sheenCol: "#ffffff", sheenRough: 0.60 },
    batik:      { light: 0.40, rough: 0.95, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.10, sheenCol: "#ffffff", sheenRough: 0.90 },

    // ----------------------------------------------------------
    // 涂层 / 工业料：有一点清漆和低粗糙度
    // ----------------------------------------------------------
    vinyl_banner: { light: 0.55, rough: 0.50, metal: 0.05, flat: false, opacity: 1.0, trans: 0, clear: 0.35, ior: 1.52, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0.08, iridIor: 1.35, sheen: 0.05, sheenCol: "#ffffff", sheenRough: 0.45 },
    awning:     { light: 0.50, rough: 0.70, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.10, sheenCol: "#ffffff", sheenRough: 0.70 },
    straw_mat:  { light: 0.45, rough: 0.95, metal: 0.00, flat: true,  opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.10, sheenCol: "#f3e7c9", sheenRough: 0.95 },
    leather:    { light: 0.40, rough: 0.90, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.05, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.10, sheenCol: "#ffffff", sheenRough: 0.80 },
    suede:      { light: 0.35, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.55, sheenCol: "#ffffff", sheenRough: 0.95 },
    metal:      { light: 0.80, rough: 0.30, metal: 1.00, flat: false, opacity: 1.0, trans: 0, clear: 0.20, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.50 },
    metalsheet: { light: 0.80, rough: 0.25, metal: 1.00, flat: false, opacity: 1.0, trans: 0, clear: 0.35, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.40 },
    rubber:     { light: 0.45, rough: 0.80, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.10, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.60 },
    silicone:   { light: 0.50, rough: 0.66, metal: 0.00, flat: false, opacity: 0.96, trans: 0.10, clear: 0.22, ior: 1.42, thick: 0.18, atten: 1.6, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.05, sheenCol: "#ffffff", sheenRough: 0.60 },
    neoprene:   { light: 0.45, rough: 0.85, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.08, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.05, sheenCol: "#ffffff", sheenRough: 0.75 },
    foam:       { light: 0.52, rough: 0.94, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.34, sheenCol: "#ffffff", sheenRough: 0.94 },
    paper:      { light: 0.60, rough: 0.95, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.50 },
    plastic:    { light: 0.66, rough: 0.34, metal: 0.02, flat: false, opacity: 0.86, trans: 0.12, clear: 0.38, ior: 1.55, thick: 0.08, atten: 1.2, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.42 },
    bubble_wrap: { light: 0.64, rough: 0.30, metal: 0.02, flat: false, opacity: 0.82, trans: 0.28, clear: 0.40, ior: 1.50, thick: 0.12, atten: 0.8, attenCol: "#ffffff", irid: 0.18, iridIor: 1.42, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.40 },
    clingfilm:  { light: 0.74, rough: 0.17, metal: 0.03, flat: false, opacity: 0.38, trans: 0.42, clear: 0.55, ior: 1.55, thick: 0.04, atten: 0.5, attenCol: "#ffffff", irid: 0.14, iridIor: 1.38, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.30 },

    // ----------------------------------------------------------
    // 光学 / 特殊
    // ----------------------------------------------------------
    glass:      { light: 0.80, rough: 0.05, metal: 0.00, flat: false, opacity: 1.0, trans: 1.00, clear: 1.00, ior: 1.52, thick: 0.50, atten: 1.5, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.50 },
    jelly:      { light: 0.52, rough: 0.34, metal: 0.00, flat: false, opacity: 0.92, trans: 0.78, clear: 0.55, ior: 1.40, thick: 0.90, atten: 2.4, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.55 },
    film:       { light: 0.84, rough: 0.20, metal: 0.22, flat: false, opacity: 0.22, trans: 0.22, clear: 0.62, ior: 1.58, thick: 0.08, atten: 0.5, attenCol: "#ffffff", irid: 0.30, iridIor: 1.42, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.55 },
    holographic: { light: 0.92, rough: 0.26, metal: 0.70, flat: false, opacity: 0.78, trans: 0, clear: 0.62, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0.85, iridIor: 1.55, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.45 },
    wet_cloth:  { light: 0.70, rough: 0.30, metal: 0.06, flat: false, opacity: 0.92, trans: 0.08, clear: 0.30, ior: 1.33, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.26, sheenCol: "#ffffff", sheenRough: 0.40 },
    // ---- 与新增法线贴图配套的材质 ----
    oxford:      { light: 0.55, rough: 0.65, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.10, ior: 1.52, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.15, sheenCol: "#ffffff", sheenRough: 0.65 },
    duck_canvas: { light: 0.45, rough: 0.92, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.12, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.10, sheenCol: "#ffffff", sheenRough: 0.90 },
    sateen:      { light: 0.64, rough: 0.32, metal: 0.04, flat: false, opacity: 1.0, trans: 0, clear: 0.05, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.56, sheenCol: "#fdf3f5", sheenRough: 0.40 },
    jersey:      { light: 0.50, rough: 0.88, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.55, sheenCol: "#ffffff", sheenRough: 0.85 },
    rib_knit:    { light: 0.45, rough: 0.92, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.60, sheenCol: "#ffffff", sheenRough: 0.88 },
    plisse:      { light: 0.55, rough: 0.55, metal: 0.05, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.25, sheenCol: "#ffffff", sheenRough: 0.55 },
    tweed:       { light: 0.40, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.45, sheenCol: "#f5efe6", sheenRough: 0.95 },
    bamboo_mat:  { light: 0.50, rough: 0.45, metal: 0.05, flat: true,  opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.15, sheenCol: "#f2e8cf", sheenRough: 0.50 },
    tinfoil:     { light: 0.88, rough: 0.36, metal: 0.95, flat: false, opacity: 1.0, trans: 0, clear: 0.25, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0.12, iridIor: 1.42, sheen: 0.00, sheenCol: "#ffffff", sheenRough: 0.45 },
    cork:        { light: 0.45, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.15, sheenCol: "#e9dcc3", sheenRough: 1.00 },
    devore:      { light: 0.55, rough: 0.55, metal: 0.00, flat: false, opacity: 0.80, trans: 0.25, clear: 0.05, ior: 1.50, thick: 0.05, atten: 1.5, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.70, sheenCol: "#ffffff", sheenRough: 0.75 },
    perforated:  { light: 0.66, rough: 0.46, metal: 0.06, flat: false, opacity: 0.62, trans: 0.18, clear: 0.22, ior: 1.55, thick: 0.05, atten: 0.8, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.06, sheenCol: "#ffffff", sheenRough: 0.48 },
    mesh_banner: { light: 0.70, rough: 0.40, metal: 0.05, flat: false, opacity: 0.88, trans: 0.05, clear: 0.00, ior: 1.54, thick: 0.02, atten: 2.0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.10, sheenCol: "#ffffff", sheenRough: 0.45 },
    habotai:     { light: 0.64, rough: 0.30, metal: 0.03, flat: false, opacity: 0.90, trans: 0.08, clear: 0.05, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.78, sheenCol: "#fff6f7", sheenRough: 0.45 },
    fishnet:     { light: 0.74, rough: 0.38, metal: 0.06, flat: false, opacity: 0.30, trans: 0.62, clear: 0.08, ior: 1.52, thick: 0.05, atten: 3.0, attenCol: "#eef2ff", irid: 0, iridIor: 1.3, sheen: 0.08, sheenCol: "#ffffff", sheenRough: 0.42 },
    glitter_seqn:{ light: 0.72, rough: 0.34, metal: 0.45, flat: false, opacity: 1.0, trans: 0, clear: 0.08, ior: 1.55, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0.55, iridIor: 1.50, sheen: 0.05, sheenCol: "#ffffff", sheenRough: 0.55 },
    fleece:      { light: 0.42, rough: 1.00, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.85, sheenCol: "#ffffff", sheenRough: 0.98 },
    hook:        { light: 0.55, rough: 0.85, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.50, sheenCol: "#ffffff", sheenRough: 0.85 },
    cable_knit:  { light: 0.40, rough: 0.95, metal: 0.00, flat: false, opacity: 1.0, trans: 0, clear: 0.00, ior: 1.50, thick: 0, atten: 0, attenCol: "#ffffff", irid: 0, iridIor: 1.3, sheen: 0.65, sheenCol: "#ffffff", sheenRough: 0.90 },
};

const windPresets = {
    still:   { strength: 0.10, dir: 0,   noiseAmp: 0.25, random: 0.35, speed: 1.0 },
    breeze:  { strength: 0.30, dir: 0,   noiseAmp: 0.40, random: 0.50, speed: 1.6 },
    gentle:  { strength: 0.80, dir: 45,  noiseAmp: 0.60, random: 0.70, speed: 2.0 },
    strong:  { strength: 1.50, dir: 90,  noiseAmp: 0.80, random: 0.40, speed: 3.0 },
    gale:    { strength: 2.00, dir: 135, noiseAmp: 1.00, random: 0.90, speed: 4.0 },
    storm:   { strength: 2.60, dir: 160, noiseAmp: 1.00, random: 1.00, speed: 5.0 },
    updraft: { strength: 1.20, dir: 90,  noiseAmp: 0.55, random: 0.65, speed: 2.4 },
    downdraft: { strength: 0.90, dir: 270, noiseAmp: 0.45, random: 0.55, speed: 1.8 },
    fluttering: { strength: 0.70, dir: 0, noiseAmp: 0.95, random: 0.85, speed: 4.2 },
    calm_pulse: { strength: 0.55, dir: 30, noiseAmp: 0.30, random: 0.20, speed: 0.8 }
};

const collisionPresets = {
    perf:    { radius: 0.75, force: 0.45, iters: 1 },
    soft:    { radius: 0.85, force: 0.65, iters: 2 },
    balance: { radius: 0.95, force: 0.85, iters: 2 },
    quality: { radius: 1.10, force: 1.00, iters: 3 },
    hard:    { radius: 1.25, force: 1.35, iters: 4 }
};

const tearPresets = {
    tofu:   1.02,
    soft:   1.05,
    normal: 1.20,
    tough:  1.60,
    metal:  3.00
};

const zoomSlider = document.getElementById("zoom");
const camXSlider = document.getElementById("camX");
const camYSlider = document.getElementById("camY");
const pinRadiusSlider = document.getElementById("pinRadius");
const knifeRadiusSlider = document.getElementById("knifeRadius");
const windSlider = document.getElementById("wind");
const windDirSlider = document.getElementById("windDir");
const stiffnessSlider = document.getElementById("stiffness");
const maxStretchSlider = document.getElementById("maxStretch");
const dampingSlider = document.getElementById("damping");
const gravitySlider = document.getElementById("gravity");
const massSlider = document.getElementById("mass");
const lightIntensitySlider = document.getElementById("lightIntensity");
const lightStyleSelect = document.getElementById("lightStyle");
const toonStepsSlider = document.getElementById("toonSteps");
const simMultSlider = document.getElementById("simMult");
const meshResSlider = document.getElementById("meshRes");

const windNoiseAmpSlider = document.getElementById("windNoiseAmp");
const windRandomSlider = document.getElementById("windRandom");
const windSpeedSlider = document.getElementById("windSpeed");
const outlineThickSlider = document.getElementById("outlineThick");
const outlineColorInput = document.getElementById("outlineColor");
const clothColorInput = document.getElementById("clothColor");

const toggleWind = document.getElementById("toggleWind");
const windPresetSelect = document.getElementById("windPreset");
const collisionPresetSelect = document.getElementById("collisionPreset");
let windEnabled = false;

const pbrTextureSelect = document.getElementById("pbrTextureSelect");
const pbrTexSizeCtrl = document.getElementById("pbrTexSizeCtrl");
const pbrTextureSizeSlider = document.getElementById("pbrTextureSize");
const pbrNormalScaleCtrl = document.getElementById("pbrNormalScaleCtrl");
const pbrNormalScaleSlider = document.getElementById("pbrNormalScale");

const togglePbrNoise = document.getElementById("togglePbrNoise");
const pbrNoiseCtrl = document.getElementById("pbrNoiseCtrl");
const pbrNoiseStyleSelect = document.getElementById("pbrNoiseStyle");
const pbrNoiseIntensityCtrl = document.getElementById("pbrNoiseIntensityCtrl");
const pbrNoiseIntensitySlider = document.getElementById("pbrNoiseIntensity");
const pbrNoiseSizeCtrl = document.getElementById("pbrNoiseSizeCtrl");
const pbrNoiseSizeSlider = document.getElementById("pbrNoiseSize");

const customNormalInput = document.getElementById("customNormalInput");
const customNormalCtrl = document.getElementById("customNormalCtrl");
const clearCustomNormalBtn = document.getElementById("clearCustomNormalBtn");

const textureFilterSelect = document.getElementById("textureFilterSelect");
const toggleHolo = document.getElementById("toggleHolo");
let holoEnabled = false;
const filterStrengthSlider = document.getElementById("filterStrength");
const filterStrengthCtrl = document.getElementById("filterStrengthCtrl");
const filterStrengthValue = document.getElementById("filterStrengthValue");
let currentFilterType = "none";
let currentFilterStrength = 0.3;
const holoIntensitySlider = document.getElementById("holoIntensity");
const holoIntensityCtrl = document.getElementById("holoIntensityCtrl");
const holoIntensityValue = document.getElementById("holoIntensityValue");

const bgLayer = document.getElementById("bgLayer");
const bgImage = document.getElementById("bgImage");
const bgColorInput = document.getElementById("bgColor");
const bgImageInput = document.getElementById("bgImageInput");
const bgScaleSlider = document.getElementById("bgScale");
const bgXSlider = document.getElementById("bgX");
const bgYSlider = document.getElementById("bgY");
const toggleBgEnv = document.getElementById("toggleBgEnv");
const resetBgBtn = document.getElementById("resetBgBtn");

const lightColorInput = document.getElementById("lightColor");
const lightXSlider = document.getElementById("lightX");
const lightYSlider = document.getElementById("lightY");
const lightZSlider = document.getElementById("lightZ");
const resetLightPosBtn = document.getElementById("resetLightPosBtn");
const resetCamBtn = document.getElementById("resetCamBtn");

const roughnessSlider = document.getElementById("roughness");
const metalnessSlider = document.getElementById("metalness");
const opacitySlider = document.getElementById("opacity");
const toggleFlat = document.getElementById("toggleFlat");
const materialPresetSelect = document.getElementById("materialPreset");

const toggleThickness = document.getElementById("toggleThickness");
const thicknessCtrl = document.getElementById("thicknessCtrl");
const thicknessColorCtrl = document.getElementById("thicknessColorCtrl");
const thicknessTexCtrl = document.getElementById("thicknessTexCtrl");
const toggleThicknessTex = document.getElementById("toggleThicknessTex");
const thicknessSizeSlider = document.getElementById("thicknessSize");
const thicknessColorInput = document.getElementById("thicknessColor");

const toggleTex = document.getElementById("toggleTex");
const toggleLight = document.getElementById("toggleLight");
const toggleShadow = document.getElementById("toggleShadow");
const toggleCollision = document.getElementById("toggleCollision");
// 🧷 自碰撞质量档位（标准 / 轻量）与「休眠前检查残余形变」开关
const collisionQualitySelect = document.getElementById("collisionQuality");
const toggleSleepGuard = document.getElementById("toggleSleepGuard");
const toggleAutoRescue = document.getElementById("toggleAutoRescue");
// 🫨 抖一抖：短促随机冲量，用来解开缠住/穿模的状态
// ⚠️ 这三个滑块引用必须先声明再取元素：script.js 是模块，let 有暂时性死区（TDZ），
//    先赋值后声明会直接抛 "Cannot access 'shakeAmpSlider' before initialization"。
let shakeAmpSlider = null, shakeFramesSlider = null, shapeScaleSlider = null;
const btnShake = document.getElementById("btnShake");
shakeAmpSlider = document.getElementById("shakeAmp");
shakeFramesSlider = document.getElementById("shakeFrames");
shapeScaleSlider = document.getElementById("shapeScale");
// 🩺 拓扑自检按钮
const btnSelfCheck = document.getElementById("btnSelfCheck");
const toggleOutline = document.getElementById("toggleOutline");
const toggleGrid = document.getElementById("toggleGrid");

const toggleBlur = document.getElementById("toggleBlur");
const blurCtrl = document.getElementById("blurCtrl");
const blurStrengthSlider = document.getElementById("blurStrength");

const flipHBtn = document.getElementById("flipHBtn");
const flipVBtn = document.getElementById("flipVBtn");

const btnPinStroke = document.getElementById("btnPinStroke");
const btnEraser = document.getElementById("btnEraser");
const pauseBtn = document.getElementById("pauseBtn");

const eraserModeCtrl = document.getElementById("eraserModeCtrl");
const eraserModeSelect = document.getElementById("eraserModeSelect");
const knifeRadiusCtrl = document.getElementById("knifeRadiusCtrl");

const tearSettingsGroup = document.getElementById("tearSettingsGroup");
const tearThresholdSlider = document.getElementById("tearThreshold");
const tearPresetSelect = document.getElementById("tearPresetSelect");

const dragModeRadios = document.querySelectorAll('input[name="dragModeRadio"]');
const dragRadiusCtrl = document.getElementById("dragRadiusCtrl");
const dragRadiusSlider = document.getElementById("dragRadius");
const maxDragDistanceCtrl = document.getElementById("maxDragDistanceCtrl");
const maxDragDistanceSlider = document.getElementById("maxDragDistance");
const physicsPresetSelect = document.getElementById("physicsPreset");
const collisionRadiusSlider = document.getElementById("collisionRadius");
const collisionForceSlider = document.getElementById("collisionForce");
const collisionItersSlider = document.getElementById("collisionIters");
let dragMode = "single";

const dragDepthSelect = document.getElementById("dragDepthSelect");

const btnPourWater = document.getElementById("btnPourWater");
const evapSpeedSlider = document.getElementById("evapSpeed");
const wetnessValueEl = document.getElementById("wetnessValue");
const waterDropSizeSlider = document.getElementById("waterDropSize");
const waterDropSizeValueEl = document.getElementById("waterDropSizeValue");
const waterDropDensitySlider = document.getElementById("waterDropDensity");
const waterDropDensityValueEl = document.getElementById("waterDropDensityValue");
const waterNormalIntensitySlider = document.getElementById("waterNormalIntensity");
const waterNormalIntensityValueEl = document.getElementById("waterNormalIntensityValue");

const decorDefaultSettings = document.getElementById("decorDefaultSettings");
const decorSelectedSettings = document.getElementById("decorSelectedSettings");
const decorTypeSelect = document.getElementById("decorTypeSelect");
const decorMatSelect = document.getElementById("decorMatSelect");
const decorWeightSelect = document.getElementById("decorWeightSelect");
const decorSizeSlider = document.getElementById("decorSizeSlider");
const decorSizeValue = document.getElementById("decorSizeValue");

const selDecorType = document.getElementById("selDecorType");
const selDecorMat = document.getElementById("selDecorMat");
const selDecorWeight = document.getElementById("selDecorWeight");
const selDecorSize = document.getElementById("selDecorSize");
const selDecorSizeValue = document.getElementById("selDecorSizeValue");
const btnDeleteSelected = document.getElementById("btnDeleteSelected");

window.addEventListener('languageChanged', () => {
    if (isSimulating) {
        pauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i> <span>${window.I18N[window.currentLang].btn_pause}</span>`;
    } else {
        pauseBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span>${window.I18N[window.currentLang].btn_resume}</span>`;
    }
});

pauseBtn.onclick = () => {
    isSimulating = !isSimulating;
    // 🪶 恢复解算时唤醒低配求解器，避免它停在休眠状态"看起来没反应"
    if (isSimulating && cloth) cloth.wake();
    if (isSimulating) {
        pauseBtn.innerHTML = `<i class="fa-solid fa-pause"></i> <span>${window.I18N[window.currentLang].btn_pause}</span>`;
        pauseBtn.classList.remove("btn-warning");
        pauseBtn.classList.add("btn-normal");
    } else {
        pauseBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span>${window.I18N[window.currentLang].btn_resume}</span>`;
        pauseBtn.classList.remove("btn-normal");
        pauseBtn.classList.add("btn-warning");
    }
};

// 🫨 抖一抖：连续几帧给每个非固定质点一个随机速度（Verlet 里等价于改 oldX/Y/Z），
// 制造一次"甩一甩"的冲击，帮已经把两层缠住的布料跳出局部极小。
// 比手动拉扯省事，而且冲量是零均值的，不会破坏已有的褶皱走向。
let shakeFramesLeft = 0;
// 形状缩放因子（0 = 原始尺寸；负数收紧、正数松弛）
let shapeFactor = 0;

function shakeCloth() {
    if (!cloth || !cloth.particles || !cloth.particles.length) return;
    if (!isSimulating) pauseBtn.click();     // 暂停状态下先恢复解算，否则抖了也不动
    cloth.wake();
    shakeFramesLeft = readShakeFrames();
}

/** 读"抖动时长"滑块（1~120 帧） */
function readShakeFrames() {
    const v = shakeFramesSlider ? parseInt(shakeFramesSlider.value) : 8;
    return Number.isFinite(v) ? Math.max(1, Math.min(120, v)) : 8;
}

/** 读"抖动力度"滑块（0~20 倍格距） */
function readShakeAmp() {
    const v = shakeAmpSlider ? parseFloat(shakeAmpSlider.value) : 1.1;
    return Number.isFinite(v) ? Math.max(0, Math.min(20, v)) : 1.1;
}

function applyShakeImpulse() {
    if (!cloth || !cloth.particles || !cloth.particles.length) { shakeFramesLeft = 0; return; }
    const amp = (cloth.baseRestLength || 0.03) * readShakeAmp();
    if (amp <= 0) { shakeFramesLeft = 0; return; }
    const ps = cloth.particles;
    for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (p.pinned) continue;
        // 随机方向；z 分量给得更多（把叠在一起的两层"吹开"最有效）
        const vx = (Math.random() - 0.5) * amp;
        const vy = (Math.random() - 0.5) * amp * 0.7;
        const vz = (Math.random() - 0.5) * amp * 1.6;
        p.oldX = p.x - vx;
        p.oldY = p.y - vy;
        p.oldZ = p.z - vz;
    }
    shakeFramesLeft--;
}

/**
 * 形状 → 缩放因子：把布料所有静止长度按 (1 + factor) 等比缩放。
 * factor < 0：布"想"收缩 → 表面绷紧、出现细密褶皱（类似 Blender 的 shrink_min）
 * factor > 0：布"想"膨胀 → 变得松弛、被悬挂点拖住（类似 shrink_max）
 * 之所以走求解器而不是直接改 objects：求解器内部按"比例增量"应用，
 * 可以和塑性形变、撕裂并存，反复拖动滑块也不会重复缩放。
 */
function applyShapeScale() {
    if (!cloth) return;
    // 记在布料上：新建的布（点"生成"之后）在第一次 simulate 创建求解器时要用到它，
    // 否则会出现"滑块停在 -0.3、布却是原始尺寸"的假死状态
    cloth._wantShape = shapeFactor;
    if (!cloth._solver) return;
    cloth._solver.setShapeScale(shapeFactor);
}

/** 开局把所有滑杆归位（含形状缩放因子），避免出现空白/NaN 的控件 */
function syncShapeSliderFromState() {
    if (!shapeScaleSlider) return;
    shapeScaleSlider.value = shapeFactor;
    const disp = document.getElementById("shapeScaleValue");
    if (disp) disp.textContent = (Number.isFinite(shapeFactor) ? shapeFactor : 0).toFixed(3);
}
syncShapeSliderFromState();

if (btnShake) btnShake.onclick = shakeCloth;
if (btnSelfCheck) btnSelfCheck.onclick = () => { if (typeof runSelfCheck === "function") runSelfCheck(); };

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const restoreBtn = document.getElementById("restoreBtn");
let undoStack = [];
let redoStack = [];

function saveHistory() {
    const state = {
        pinStrokeList: JSON.parse(JSON.stringify(pinStrokeList)),
        decorPlacementList: JSON.parse(JSON.stringify(decorPlacementList))
    };
    if (cloth) {
        state.brokenSprings = cloth.springs.map((s, i) => s.broken ? i : -1).filter(i => i !== -1);
        state.cutFaces = Array.from(cloth.cutFaces);
    }
    undoStack.push(state);
    redoStack = [];
}

function applyHistoryState(state) {
    pinStrokeList = state.pinStrokeList;
    if (state.decorPlacementList) {
        decorPlacementList = state.decorPlacementList;
    }
    if (cloth) {
        cloth.springs.forEach((s, i) => s.broken = state.brokenSprings.includes(i));

        if (state.cutFaces) {
            cloth.cutFaces = new Uint8Array(state.cutFaces);
            const idxArr = cloth.mesh.geometry.index.array;
            const tIdxArr = cloth.thicknessGeometry.index.array;
            for (let i = 0; i < cloth.cutFaces.length; i++) {
                if (cloth.cutFaces[i]) {
                    idxArr[i * 3] = 0;
                    idxArr[i * 3 + 1] = 0;
                    idxArr[i * 3 + 2] = 0;
                    tIdxArr[i * 3] = 0;
                    tIdxArr[i * 3 + 1] = 0;
                    tIdxArr[i * 3 + 2] = 0;
                } else {
                    idxArr[i * 3] = cloth.originalIndexList[i * 3];
                    idxArr[i * 3 + 1] = cloth.originalIndexList[i * 3 + 1];
                    idxArr[i * 3 + 2] = cloth.originalIndexList[i * 3 + 2];
                    tIdxArr[i * 3] = cloth.originalBottomIndex[i * 3];
                    tIdxArr[i * 3 + 1] = cloth.originalBottomIndex[i * 3 + 1];
                    tIdxArr[i * 3 + 2] = cloth.originalBottomIndex[i * 3 + 2];
                }
            }
            cloth.mesh.geometry.index.needsUpdate = true;
            cloth.thicknessGeometry.index.needsUpdate = true;
        }

        if (tearCtx) {
            tearCtx.fillStyle = '#ffffff';
            tearCtx.fillRect(0, 0, tearCanvas.width, tearCanvas.height);
            for(let i = 0; i < cloth.springs.length; i++) {
                if(cloth.springs[i].broken) {
                    const p1 = cloth.particles[cloth.springs[i].i];
                    const p2 = cloth.particles[cloth.springs[i].j];
                    const u = (p1.ix / cloth.resX + p2.ix / cloth.resX) / 2;
                    const v = (p1.iy / cloth.resY + p2.iy / cloth.resY) / 2;
                    drawTearSpot(u, v, 0.04, true);
                }
            }
            if (tearTexture) tearTexture.needsUpdate = true;
        }
    }
    clearSelection();
    redrawPreview();
    // 🪶 撤销/重做改动了弹簧断裂状态，唤醒低配求解器重新解算
    if (cloth) cloth.wake();
}

undoBtn.onclick = () => {
    if (undoStack.length === 0) return;
    const currentState = {
        pinStrokeList: JSON.parse(JSON.stringify(pinStrokeList)),
        decorPlacementList: JSON.parse(JSON.stringify(decorPlacementList))
    };
    if (cloth) {
        currentState.brokenSprings = cloth.springs.map((s, i) => s.broken ? i : -1).filter(i => i !== -1);
        currentState.cutFaces = Array.from(cloth.cutFaces);
    }
    redoStack.push(currentState);

    const state = undoStack.pop();
    applyHistoryState(state);
};

redoBtn.onclick = () => {
    if (redoStack.length === 0) return;
    const currentState = {
        pinStrokeList: JSON.parse(JSON.stringify(pinStrokeList)),
        decorPlacementList: JSON.parse(JSON.stringify(decorPlacementList))
    };
    if (cloth) {
        currentState.brokenSprings = cloth.springs.map((s, i) => s.broken ? i : -1).filter(i => i !== -1);
        currentState.cutFaces = Array.from(cloth.cutFaces);
    }
    undoStack.push(currentState);

    const state = redoStack.pop();
    applyHistoryState(state);
};

restoreBtn.onclick = () => {
    if (!cloth) return;
    let changed = false;
    cloth.springs.forEach(s => {
        if (s.broken) {
            s.broken = false;
            changed = true;
        }
    });
    if (cloth.cutFaces.some(v => v === 1)) {
        cloth.cutFaces.fill(0);
        const idxArr = cloth.mesh.geometry.index.array;
        for (let i = 0; i < cloth.originalIndexList.length; i++) {
            idxArr[i] = cloth.originalIndexList[i];
        }
        cloth.mesh.geometry.index.needsUpdate = true;

        const tIdxArr = cloth.thicknessGeometry.index.array;
        for (let i = 0; i < cloth.originalBottomIndex.length; i++) {
            tIdxArr[i] = cloth.originalBottomIndex[i];
        }
        cloth.thicknessGeometry.index.needsUpdate = true;

        changed = true;
    }
    if (changed) {
        saveHistory();
        if (tearCtx) {
            tearCtx.fillStyle = '#ffffff';
            tearCtx.fillRect(0, 0, tearCanvas.width, tearCanvas.height);
            if (tearTexture) tearTexture.needsUpdate = true;
        }
    }
};

window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const isModifier = e.ctrlKey || e.metaKey;
    if (isModifier) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
            e.preventDefault();
            if (e.shiftKey) redoBtn.click(); else undoBtn.click();
        } else if (key === 'y') {
            e.preventDefault();
            redoBtn.click();
        }
    }
});

function setDrawMode(mode) {
    drawMode = mode;
    btnPinStroke.classList.remove("btn-active");
    btnEraser.classList.remove("btn-active");
    document.getElementById("btnDecor").classList.remove("btn-active");

    eraserModeCtrl.style.display = "none";
    document.getElementById("decorEditPanel").style.display = "none";

    if (mode === "pinstroke") { btnPinStroke.classList.add("btn-active"); }
    else if (mode === "eraser") { btnEraser.classList.add("btn-active"); eraserModeCtrl.style.display = "grid"; }
    else if (mode === "decor") {
        document.getElementById("btnDecor").classList.add("btn-active");
        document.getElementById("decorEditPanel").style.display = "block";
    }
    clearSelection();
}

btnPinStroke.onclick = () => setDrawMode("pinstroke");
btnEraser.onclick = () => setDrawMode("eraser");
eraserModeSelect.onchange = () => { eraserMode = eraserModeSelect.value; };

document.getElementById("btnDecor").onclick = () => setDrawMode("decor");
document.getElementById("btnClearDecor").onclick = () => {
    saveHistory();
    decorPlacementList = [];
    clearSelection();
    redrawPreview();
};

function clearSelection() {
    selectedDecorIndex = -1;
    draggingDecorIndex = -1;
    decorDefaultSettings.style.display = "block";
    decorSelectedSettings.style.display = "none";
}

// 实时更新已选中的 3D 模型
function updateSelectedDecor3D() {
    // 确保在 3D 模式且选中了装饰
    if (editMode || selectedDecorIndex < 0 || selectedDecorIndex >= decorPlacementList.length) return;
    if (!decorations || !decorations[selectedDecorIndex]) return;

    const d2D = decorPlacementList[selectedDecorIndex];
    const d3D = decorations[selectedDecorIndex];

    // 1. 从场景中移除旧模型并清理内存
    detachFromScene(d3D.mesh);
    d3D.mesh.traverse(child => {
        if (child.isMesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
        }
    });

    // 2. 用新属性重新生成模型
    const newMesh = create3DDecorMesh(d2D.type, d2D.color, d2D.mat, d2D.size);
    scene.add(newMesh);

    // 3. 更新数据引用
    d3D.mesh = newMesh;
    d3D.radius = newMesh.userData.radius;
    d3D.weight = d2D.weight;

    // 4. 立即更新一次它的位置，防止它飞在原点
    updateDecorations();
}

function syncSelectedDecorToUI() {
    if (selectedDecorIndex < 0 || selectedDecorIndex >= decorPlacementList.length) return;
    const d = decorPlacementList[selectedDecorIndex];
    selDecorType.value = d.type;
    selDecorMat.value = d.mat;
    selDecorWeight.value = d.weight;
    selDecorSize.value = d.size;
    selDecorSizeValue.textContent = parseFloat(d.size).toFixed(1);
    
    // 同步颜色
    if (selDecorColor) {
        // 如果之前的颜色有记录就用记录的，没有就用默认
        selDecorColor.value = d.color || "#FFB7C5";
    }
}

selDecorType.onchange = () => {
    if (selectedDecorIndex >= 0) { 
        decorPlacementList[selectedDecorIndex].type = selDecorType.value; 
        rebuildAllDecorations3D(); // 暴力重建
        redrawPreview(); 
    }
};
selDecorMat.onchange = () => {
    if (selectedDecorIndex >= 0) { 
        decorPlacementList[selectedDecorIndex].mat = selDecorMat.value; 
        rebuildAllDecorations3D(); // 暴力重建
        redrawPreview(); 
    }
};
selDecorWeight.onchange = () => {
    if (selectedDecorIndex >= 0) { 
        decorPlacementList[selectedDecorIndex].weight = selDecorWeight.value; 
        rebuildAllDecorations3D(); // 暴力重建
        redrawPreview(); 
    }
};
selDecorSize.oninput = () => {
    selDecorSizeValue.textContent = parseFloat(selDecorSize.value).toFixed(1);
    if (selectedDecorIndex >= 0) { 
        decorPlacementList[selectedDecorIndex].size = parseFloat(selDecorSize.value); 
        rebuildAllDecorations3D(); // 暴力重建
        redrawPreview(); 
    }
};
function rebuildAllDecorations3D() {
    if (editMode || !cloth) return;

    // 1. 彻底清除旧模型
    decorations.forEach(d => {
        detachFromScene(d.mesh);
        d.mesh.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        });
    });
    decorations = [];

    // 2. 重新计算坐标并生成新模型
    let maxW = BOUND_SCALE * 2 * 0.95;
    let maxH = maxW;
    if (imgAspect >= 1) maxH = maxW / imgAspect; else maxW = maxH * imgAspect;
    const bounds = { minX: -maxW / 2, maxX: maxW / 2, minY: -maxH / 2, maxY: maxH / 2 };

    for (const d of decorPlacementList) {
        let u = (d.x - bounds.minX) / (bounds.maxX - bounds.minX);
        let v = (d.y - bounds.minY) / (bounds.maxY - bounds.minY);
        let ix = Math.max(0, Math.min(cloth.resX, Math.round(u * cloth.resX)));
        let iy = Math.max(0, Math.min(cloth.resY, Math.round(v * cloth.resY)));
        const pIndex = iy * (cloth.resX + 1) + ix;

        const mesh = create3DDecorMesh(d.type, d.color, d.mat, d.size);
        (sceneHolder || scene).add(mesh);
        decorations.push({
            mesh: mesh,
            particleIndex: pIndex,
            radius: mesh.userData.radius,
            weight: d.weight
        });
    }
    updateDecorations();
}

selDecorColor.oninput = () => {
    if (selectedDecorIndex >= 0) {
        // 1. 更新 2D 数据
        decorPlacementList[selectedDecorIndex].color = selDecorColor.value;
        // 2. 重新绘制 2D 预览
        redrawPreview();
        
        // 3. 如果已经生成了 3D 布料，实时更新 3D 模型材质颜色
        // 注意：decorations 数组是按生成时的顺序存的，需找到对应的 3D mesh
        // 由于我们保存了 decorPlacementList，此时 selectedDecorIndex 对应的就是第 index 个装饰
        if (decorations[selectedDecorIndex] && decorations[selectedDecorIndex].mesh) {
            const mesh = decorations[selectedDecorIndex].mesh;
            const newColor = new THREE.Color(selDecorColor.value);
            
            // 遍历 mesh 的所有子对象更新材质（因为现在很多形状是 Group）
            mesh.traverse((child) => {
                if (child.isMesh) {
                    // 排除掉猫爪、樱桃的绿色梗、花心的黄色、纽扣的孔洞等特殊材质（可以通过 name 或自定义属性区分）
                    // 简单处理：如果材质有 color 属性，就更新
                    if (child.material && child.material.color) {
                        // 如果是特殊材质（如纽扣孔洞、花心、果梗），可以跳过
                        // 你可以通过在创建时给它们打上 userData.isSpecial = true 来跳过
                        if (!child.userData.isSpecial) {
                            child.material.color.copy(newColor);
                            // 如果是全息材质，emissive 也要跟着变
                            if (child.material.emissive && child.material.metalness > 0.5) {
                                child.material.emissive.copy(newColor);
                            }
                        }
                    }
                }
            });
        }
    }
};

btnDeleteSelected.onclick = () => {
    if (selectedDecorIndex >= 0) {
        saveHistory();
        decorPlacementList.splice(selectedDecorIndex, 1);
        clearSelection();
        redrawPreview();
    }
};

decorSizeSlider.oninput = () => { decorSizeValue.textContent = parseFloat(decorSizeSlider.value).toFixed(1); };

// ==============================================================
// 🧵 预设下拉框：从数据表生成选项（分组 + i18n 文案集中在下面两处）
// 说明：HTML 里只留一个空 <select>，选项全部由这里生成，
//       这样以后加面料只要改 PHYSICS_GROUPS / physicsPresets 两处。
// ==============================================================
const PHYSICS_GROUPS = [
    { titleKey: "preset_group_daily", items: ["cotton", "washed_cotton", "linen", "wool", "velvet", "worsted_wool", "tr_blend", "polyester", "nylon", "terry", "felt", "corduroy", "sherpa", "chenille", "mohair", "satin", "sateen", "taffeta", "organza", "tulle", "lace", "silk", "habotai", "chiffon", "gauze", "spidersilk", "flag", "spandex", "sportmesh", "jersey", "rib_knit", "plisse", "tweed", "devore", "fleece", "hook", "cable_knit"] },
    { titleKey: "preset_group_heavy", items: ["denim", "canvas", "duck_canvas", "oxford", "vinyl_banner", "mesh_banner", "awning", "burlap", "straw_mat", "bamboo_mat", "leather", "suede", "metal", "metalsheet", "glitter_seqn", "tinfoil", "cork", "perforated"] },
    { titleKey: "preset_group_special", items: ["rubber", "silicone", "neoprene", "jelly", "foam", "paper", "plastic", "bubble_wrap", "clingfilm", "fishnet"] }
];

// 没加载到 i18n 时的兜底文字（正常运行时会被 i18n 覆盖）
const PRESET_TEXT_FALLBACK = {
    preset_group_daily: "日常服装面料",
    preset_group_heavy: "厚重 / 工业面料",
    preset_group_special: "橡胶 / 弹性体 / 特殊手感",
    preset_custom: "自定义"
};

function presetLabel(key) {
    const dict = (window.I18N && window.I18N[window.currentLang || "zh"]) || {};
    return dict["preset_" + key] || PRESET_TEXT_FALLBACK["preset_" + key] || key;
}

function fillPhysicsPresetOptions() {
    if (!physicsPresetSelect) return;
    const prev = physicsPresetSelect.value;
    physicsPresetSelect.innerHTML = "";
    const opCustom = document.createElement("option");
    opCustom.value = "custom";
    opCustom.textContent = presetLabel("custom");
    physicsPresetSelect.appendChild(opCustom);
    for (const group of PHYSICS_GROUPS) {
        const og = document.createElement("optgroup");
        og.label = presetText(group.titleKey, PRESET_TEXT_FALLBACK[group.titleKey] || group.titleKey);
        for (const key of group.items) {
            if (!physicsPresets[key]) continue;
            const op = document.createElement("option");
            op.value = key;
            op.textContent = presetLabel(key);
            og.appendChild(op);
        }
        physicsPresetSelect.appendChild(og);
    }
    physicsPresetSelect.value = prev || "custom";
}

// 换语言后把下拉框文字重刷一遍
window.addEventListener("languageChanged", () => {
    // optgroup 的 label 是属性不是文本，重建下拉框才能一起换语言
    fillPhysicsPresetOptions();
    if (typeof fillMaterialPresetOptions === "function") fillMaterialPresetOptions();
    if (typeof fillWindPresetOptions === "function") fillWindPresetOptions();
    if (typeof fillCollisionPresetOptions === "function") fillCollisionPresetOptions();
    if (typeof fillTearPresetOptions === "function") fillTearPresetOptions();
    if (typeof fillTextureFilterOptions === "function") fillTextureFilterOptions();
    if (typeof fillPbrTextureOptions === "function") fillPbrTextureOptions();
    if (typeof fillPbrNoiseOptions === "function") fillPbrNoiseOptions();
fillPbrNoiseOptions();
});

// ==============================================================
// 💨 风力 / 碰撞 / 撕扯：同样由数据表生成下拉框
// ==============================================================
function presetText(key, fallback) {
    const dict = (window.I18N && window.I18N[window.currentLang || "zh"]) || {};
    return dict[key] || fallback;
}

function fillWindPresetOptions() {
    if (!windPresetSelect) return;
    const prev = windPresetSelect.value;
    windPresetSelect.innerHTML = "";
    const opCustom = document.createElement("option");
    opCustom.value = "custom";
    opCustom.textContent = presetText("wind_custom", "自定义");
    windPresetSelect.appendChild(opCustom);
    for (const key of Object.keys(windPresets)) {
        const op = document.createElement("option");
        op.value = key;
        op.textContent = presetText("wind_" + key, key);
        windPresetSelect.appendChild(op);
    }
    windPresetSelect.value = prev || "custom";
}

function fillCollisionPresetOptions() {
    if (!collisionPresetSelect) return;
    const prev = collisionPresetSelect.value;
    collisionPresetSelect.innerHTML = "";
    const opCustom = document.createElement("option");
    opCustom.value = "custom";
    opCustom.textContent = presetText("collision_custom", "自定义");
    collisionPresetSelect.appendChild(opCustom);
    for (const key of Object.keys(collisionPresets)) {
        const op = document.createElement("option");
        op.value = key;
        op.textContent = presetText("collision_" + key, key);
        collisionPresetSelect.appendChild(op);
    }
    collisionPresetSelect.value = prev || "custom";
}

function fillTearPresetOptions() {
    if (!tearPresetSelect) return;
    const prev = tearPresetSelect.value;
    tearPresetSelect.innerHTML = "";
    const opCustom = document.createElement("option");
    opCustom.value = "custom";
    opCustom.textContent = presetText("tear_preset_custom", "自定义");
    tearPresetSelect.appendChild(opCustom);
    for (const key of Object.keys(tearPresets)) {
        const op = document.createElement("option");
        op.value = key;
        op.textContent = presetText("tear_preset_" + key, key);
        tearPresetSelect.appendChild(op);
    }

    // 撕扯阈值需要显示两位小数（1.02 这种）
    tearPresetSelect.value = prev || "custom";
}

// ============================================================
// 🎛 纹理滤镜 & PBR 纹理：数据表（选项 + 分组），由代码生成下拉框
// ============================================================
const TEXTURE_FILTER_OPTIONS = [
    "none", "tie_dye", "batik", "silk", "vintage", "denim", "ink", "holographic",
    "sun_faded", "wet_stain", "knit_grain", "film_grain"
];

const PBR_TEXTURE_GROUPS = [
    { titleKey: "pbr_group_basic", items: ["none", "weave", "square_weave", "stripe", "twill", "herringbone", "basket", "knit", "corduroy", "flax", "cashmere", "noise", "stone"] },
    { titleKey: "pbr_group_fabric", items: ["washed_cotton", "polyester", "tr_blend", "worsted_wool", "batik", "tie_dye", "gauze", "felt", "fluff", "leather", "real_leather", "suede", "wrinkle", "diamond", "puffyQuilt", "vinyl_banner", "bubble_wrap", "plastic_wrap", "rice_paper", "carbon", "oxford", "sateen", "jersey", "rib_knit", "cable_knit", "hook", "plisse", "tweed", "devore", "glitter", "fleece", "habotai", "silk_habotai"] },
    { titleKey: "pbr_group_mesh", items: ["mesh", "mesh_solid", "hex", "hex_solid", "tulle", "mesh_fine", "fishnet"] },
    { titleKey: "pbr_group_special", items: ["duck_canvas", "banner_mesh", "aluminium", "bamboo", "cork", "perforated"] }
];

function fillTextureFilterOptions() {
    if (!textureFilterSelect) return;
    const prev = textureFilterSelect.value;
    textureFilterSelect.innerHTML = "";
    for (const key of TEXTURE_FILTER_OPTIONS) {
        const op = document.createElement("option");
        op.value = key;
        op.textContent = presetText("filter_" + key, key);
        textureFilterSelect.appendChild(op);
    }
    textureFilterSelect.value = prev || "none";
}

function fillPbrTextureOptions() {
    if (!pbrTextureSelect) return;
    const prev = pbrTextureSelect.value;
    pbrTextureSelect.innerHTML = "";
    for (const group of PBR_TEXTURE_GROUPS) {
        const og = document.createElement("optgroup");
        og.label = presetText(group.titleKey, group.titleKey);
        for (const key of group.items) {
            const op = document.createElement("option");
            op.value = key;
            op.textContent = presetText("pbr_" + key, key);
            og.appendChild(op);
        }
        pbrTextureSelect.appendChild(og);
    }
    if (prev) pbrTextureSelect.value = prev;
}
// 🌫 PBR 叠加噪波的风格表（与 createNoiseNormalMap 里的分支一一对应）
const PBR_NOISE_STYLES = [
    { key: "sand", textKey: "pbr_noise_sand" },
    { key: "fiber", textKey: "pbr_noise_fiber" },
    { key: "cloud", textKey: "pbr_noise_cloud" },
    { key: "crack", textKey: "pbr_noise_crack" },
    { key: "ripple", textKey: "pbr_noise_ripple" },
    { key: "cellular", textKey: "pbr_noise_cellular" },
    { key: "wood", textKey: "pbr_noise_wood" },
    { key: "marble", textKey: "pbr_noise_marble" },
    { key: "rusty", textKey: "pbr_noise_rusty" },
    { key: "weaveNode", textKey: "pbr_noise_weave_node" },
    { key: "quilted", textKey: "pbr_noise_quilted" },
    { key: "velvet_pile", textKey: "pbr_noise_velvet_pile" },
    { key: "corduroy_soft", textKey: "pbr_noise_corduroy" },
    { key: "mesh_fine", textKey: "pbr_noise_mesh_fine" },
    { key: "hook", textKey: "pbr_noise_hook" },
    { key: "cable_knit", textKey: "pbr_noise_cable_knit" },
    { key: "snake", textKey: "pbr_noise_snake" },
    { key: "leaves", textKey: "pbr_noise_leaves" },
    { key: "camouflage", textKey: "pbr_noise_camouflage" },
    { key: "rain_streak", textKey: "pbr_noise_rain" },
    { key: "sandstone", textKey: "pbr_noise_sandstone" },
    { key: "crumple", textKey: "pbr_noise_crumple" },
    { key: "glitter", textKey: "pbr_noise_glitter" },
    { key: "honeycomb", textKey: "pbr_noise_honeycomb" },
    { key: "fleece", textKey: "pbr_noise_fleece" }
];

function fillPbrNoiseOptions() {
    if (!pbrNoiseStyleSelect) return;
    const prev = pbrNoiseStyleSelect.value;
    pbrNoiseStyleSelect.innerHTML = "";
    for (const s of PBR_NOISE_STYLES) {
        const op = document.createElement("option");
        op.value = s.key;
        op.textContent = presetText(s.textKey, s.key);
        pbrNoiseStyleSelect.appendChild(op);
    }
    pbrNoiseStyleSelect.value = prev || "sand";
}


// 把预设对应的基准旋转写到三个旋转滑块上（布料已生成时才动）
function applyRestPose(presetKey) {
    if (!cloth || !cloth.particles) return;
    const pose = REST_POSE[presetKey];
    if (!pose) return;
    if (!rotXSlider || !rotYSlider || !rotZSlider) return;
    rotXSlider.value = pose.x; rotYSlider.value = pose.y; rotZSlider.value = pose.z;
    rotXValue.textContent = pose.x + "°";
    rotYValue.textContent = pose.y + "°";
    rotZValue.textContent = pose.z + "°";
    // 交给统一的旋转入口处理（它内部会用 prevRot 计算增量并给布料一点惯性）
    if (typeof handleRotationChange === "function") handleRotationChange();
    else applyClothRotation(pose.x, pose.y, pose.z);
}

function applyPresetToSliders(preset) {
    // ===== 原有滑块 =====
    stiffnessSlider.value = preset.stiffness;
    maxStretchSlider.value = preset.maxStretch;
    dampingSlider.value = preset.damping;
    massSlider.value = preset.mass;
    if (preset.meshRes) meshResSlider.value = preset.meshRes;
    if (preset.iterations) document.getElementById("constraintIterations").value = preset.iterations;
    if (preset.hz) document.getElementById("physicsHz").value = preset.hz;
    maxDragDistanceSlider.value = preset.maxDrag;

    document.getElementById("stiffnessValue").textContent = parseFloat(preset.stiffness).toFixed(2);
    document.getElementById("maxStretchValue").textContent = parseFloat(preset.maxStretch).toFixed(1);
    document.getElementById("dampingValue").textContent = parseFloat(preset.damping).toFixed(2);
    document.getElementById("massValue").textContent = parseFloat(preset.mass).toFixed(1);
    if (preset.meshRes) document.getElementById("meshResValue").textContent = parseInt(preset.meshRes);
    if (preset.iterations) document.getElementById("constraintIterationsValue").textContent = parseInt(preset.iterations);
    if (preset.hz) document.getElementById("physicsHzValue").textContent = parseInt(preset.hz);
    document.getElementById("maxDragDistanceValue").textContent = parseFloat(preset.maxDrag).toFixed(2);

    // ===== 新扩展参数（直接写 value + display，不触发 input，不污染下拉框） =====
    const setV = (id, val, dispId, fmt) => {
        const el = document.getElementById(id);
        const dv = dispId ? document.getElementById(dispId) : null;
        // 兜底：预设里缺字段 / 值是 undefined 时，退回滑杆自己的默认值，
        // 否则 el.value = undefined 会让滑杆变成 NaN（这就是"开局显示 NaN"的来源）
        let v = val;
        if (!Number.isFinite(typeof v === "number" ? v : parseFloat(v))) {
            v = el ? parseFloat(el.defaultValue) : 0;
            if (!Number.isFinite(v)) v = 0;
        }
        if (el) el.value = v;
        if (dv) dv.textContent = fmt ? fmt(v) : v;
    };
    const p = { ...physicsExtraDefaults, ...preset };

    document.getElementById("togglePlasticity").checked = !!p.plasticity;
    plasticityEnabled = !!p.plasticity;
    setV("plasticityRate",      p.plRate,     "plasticityRateValue",     v => parseFloat(v).toFixed(2));
    setV("plasticityThreshold", p.plThreshold,"plasticityThresholdValue",v => parseFloat(v).toFixed(2));
    setV("plasticityRecovery",  p.plRecovery, "plasticityRecoveryValue", v => parseFloat(v).toFixed(3));
    setV("plasticityMax",       p.plMax,      "plasticityMaxValue",      v => parseFloat(v).toFixed(1));
    setV("bendStiffness",       p.bend,       "bendStiffnessValue",      v => parseFloat(v).toFixed(2));
    setV("shearStiffness",      p.shear,      "shearStiffnessValue",     v => parseFloat(v).toFixed(2));
    setV("stiffX",              p.stiffX,     "stiffXValue",             v => parseFloat(v).toFixed(2));
    setV("stiffY",              p.stiffY,     "stiffYValue",             v => parseFloat(v).toFixed(2));
    setV("springDamping",       p.springDamp, "springDampingValue",      v => parseFloat(v).toFixed(2));
    setV("windSpatialFreq",     p.windSpatial,"windSpatialFreqValue",    v => parseFloat(v).toFixed(1));
    setV("windZ",               p.windZ,      "windZValue",              v => parseFloat(v).toFixed(2));
    setV("gravityAngle",        p.gravAngle,  "gravityAngleValue",       v => parseInt(v) + "°");
    document.getElementById("toggleGround").checked = !!p.ground;
    groundCollisionEnabled = !!p.ground;
    setV("groundY",             p.groundY,    "groundYValue",            v => parseFloat(v).toFixed(2));
    setV("groundFriction",      p.groundFric, "groundFrictionValue",     v => parseFloat(v).toFixed(2));
    setV("collisionFriction",   p.collFric,   "collisionFrictionValue",  v => parseFloat(v).toFixed(2));
    setV("dragStrength",        p.dragStr,    "dragStrengthValue",       v => parseFloat(v).toFixed(2));
    setV("airDampingExp",       p.airExp,     "airDampingExpValue",      v => parseFloat(v).toFixed(2));
    setV("maxVelocity",         p.maxVel,     "maxVelocityValue",        v => parseFloat(v).toFixed(2));
    setV("velocityRetention",   p.velRet,     "velocityRetentionValue",  v => parseFloat(v).toFixed(3));
    // 形状缩放：它属于「造型工具」而不是面料属性，预设里不写 shape，
    // 所以切预设时**保留用户当前值**（不会被拉回 0）。
    const shapeVal = Number.isFinite(preset.shape) ? preset.shape
        : (Number.isFinite(shapeFactor) ? shapeFactor : 0);
    setV("shapeScale", shapeVal, "shapeScaleValue", v => parseFloat(v).toFixed(3));

    // 同步 JS 变量
    plasticityRate     = p.plRate;
    plasticityThreshold= p.plThreshold;
    plasticityRecovery = p.plRecovery;
    plasticityMax      = p.plMax;
    bendStiffness      = p.bend;
    shearStiffness     = p.shear;
    stiffX             = p.stiffX;
    stiffY             = p.stiffY;
    springDamping      = p.springDamp;
    windSpatialFreq    = p.windSpatial;
    windZ              = p.windZ;
    gravityAngle       = p.gravAngle;
    groundY            = p.groundY;
    groundFriction     = p.groundFric;
    collisionFriction  = p.collFric;
    dragStrength       = p.dragStr;
    airDampingExp      = p.airExp;
    maxVelocity        = p.maxVel;
    velocityRetention  = p.velRet;
    // 形状缩放：预设里没有就按 0（不缺省改动已有布料）
    shapeFactor = Number.isFinite(shapeVal) ? shapeVal : 0;

    if (preset.hz) accumulator = 0;
    // 🪶 换预设等于换了物理参数，唤醒低配求解器
    if (cloth) cloth.wake();
    // 形状缩放要真的作用到静止长度上（求解器内部按比例增量应用，可反复调用）
    applyShapeScale();
}

physicsPresetSelect.onchange = () => {
    const preset = physicsPresets[physicsPresetSelect.value];
    if (!preset) return;
    applyPresetToSliders(preset);
    // 换预设 = 有意采用该预设的网格密度
    userTouchedMeshRes = false;
    if (cloth) cloth.wake();
};

// ==============================================================
// 🎨 材质下拉框：同样由数据表生成（分组 + i18n）
// ==============================================================
const MATERIAL_GROUPS = [
    { titleKey: "mat_group_fabric", items: ["custom", "default", "cotton", "washed_cotton", "linen", "wool", "velvet", "worsted_wool", "tr_blend", "polyester", "nylon", "terry", "felt", "corduroy", "sherpa", "chenille", "mohair", "satin", "sateen", "taffeta", "organza", "tulle", "lace", "silk", "habotai", "chiffon", "gauze", "flag", "spandex", "sportmesh", "jersey", "rib_knit", "plisse", "tweed", "devore", "fleece", "hook", "cable_knit", "denim", "canvas", "burlap", "tie_dye", "batik"] },
    { titleKey: "mat_group_coated", items: ["duck_canvas", "oxford", "vinyl_banner", "mesh_banner", "awning", "burlap", "straw_mat", "bamboo_mat", "leather", "suede", "metal", "metalsheet", "glitter_seqn", "tinfoil", "cork", "perforated", "rubber", "silicone", "neoprene", "foam", "paper", "plastic", "bubble_wrap", "clingfilm"] },
    { titleKey: "mat_group_optical", items: ["glass", "jelly", "film", "holographic", "wet_cloth", "fishnet"] }
];

const MATERIAL_TEXT_FALLBACK = {
    mat_group_fabric: "布料",
    mat_group_coated: "涂层 / 工业料",
    mat_group_optical: "光学 / 特殊"
};

function materialLabel(key) {
    return presetText("mat_preset_" + key, key);
}

function fillMaterialPresetOptions() {
    if (!materialPresetSelect) return;
    const prev = materialPresetSelect.value;
    materialPresetSelect.innerHTML = "";
    for (const group of MATERIAL_GROUPS) {
        const og = document.createElement("optgroup");
        og.label = (window.I18N && window.I18N[window.currentLang || "zh"] && window.I18N[window.currentLang || "zh"][group.titleKey]) || MATERIAL_TEXT_FALLBACK[group.titleKey] || group.titleKey;
        for (const key of group.items) {
            if (!materialPresets[key]) continue;
            const op = document.createElement("option");
            op.value = key;
            op.textContent = materialLabel(key);
            og.appendChild(op);
        }
        materialPresetSelect.appendChild(og);
    }
    materialPresetSelect.value = prev || "custom";
}

// 选中材质 → 把该材质的参数写回所有相关控件
materialPresetSelect.onchange = () => {
    const preset = materialPresets[materialPresetSelect.value];
    if (!preset) return;

    lightIntensitySlider.value = preset.light;
    roughnessSlider.value = preset.rough;
    metalnessSlider.value = preset.metal;
    toggleFlat.checked = !!preset.flat;
    flatShadingEnabled = !!preset.flat;
    clothOpacity = preset.opacity;
    opacitySlider.value = preset.opacity;

    clothTransmission = preset.trans;
    clothClearcoat = preset.clear;
    clothIor = preset.ior;
    clothThickness = preset.thick;
    clothAttenuation = preset.atten;
    clothAttenuationColor = preset.attenCol;
    clothIridescence = preset.irid;
    clothIridescenceIor = preset.iridIor;
    clothSheen = preset.sheen;
    clothSheenColor = preset.sheenCol;
    clothSheenRoughness = preset.sheenRough;

    const setV = (id, val, dispId, fmt) => {
        const el = document.getElementById(id);
        const dv = document.getElementById(dispId);
        if (el) el.value = val;
        if (dv) dv.textContent = fmt ? fmt(val) : val;
    };
    setV("lightIntensity", preset.light, "lightIntensityValue", v => parseFloat(v).toFixed(2));
    setV("roughness", preset.rough, "roughnessValue", v => parseFloat(v).toFixed(2));
    setV("metalness", preset.metal, "metalnessValue", v => parseFloat(v).toFixed(2));
    setV("opacity", preset.opacity, "opacityValue", v => parseFloat(v).toFixed(2));
    setV("matTransmission", preset.trans, "matTransmissionValue");
    setV("matClearcoat", preset.clear, "matClearcoatValue");
    setV("matIor", preset.ior, "matIorValue");
    setV("matThickness", preset.thick, "matThicknessValue");
    setV("matAttenuation", preset.atten, "matAttenuationValue");
    setV("matIridescence", preset.irid, "matIridescenceValue");
    setV("matIridescenceIor", preset.iridIor, "matIridescenceIorValue");
    setV("matSheen", preset.sheen, "matSheenValue");
    setV("matSheenRoughness", preset.sheenRough, "matSheenRoughnessValue");

    const attenColorEl = document.getElementById("matAttenuationColor");
    if (attenColorEl) attenColorEl.value = preset.attenCol;
    const sheenColorEl = document.getElementById("matSheenColor");
    if (sheenColorEl) sheenColorEl.value = preset.sheenCol;

    if (dirLight && lightEnabled) dirLight.intensity = preset.light;
    if (clothMesh) switchClothMaterial();
    if (thicknessEnabled) updateThicknessMesh();

};

windPresetSelect.onchange = () => {
    const preset = windPresets[windPresetSelect.value];
    if (!preset) return;
    if (!windEnabled) { windEnabled = true; toggleWind.checked = true; }
    windSlider.value = preset.strength;
    windDirSlider.value = preset.dir;
    windNoiseAmpSlider.value = preset.noiseAmp;
    windRandomSlider.value = preset.random;
    windSpeedSlider.value = preset.speed;

    document.getElementById("windValue").textContent = parseFloat(preset.strength).toFixed(2);
    document.getElementById("windDirValue").textContent = parseInt(preset.dir) + "°";
    document.getElementById("windNoiseAmpValue").textContent = parseFloat(preset.noiseAmp).toFixed(2);
    document.getElementById("windRandomValue").textContent = parseFloat(preset.random).toFixed(2);
    document.getElementById("windSpeedValue").textContent = parseFloat(preset.speed).toFixed(2);
    if (cloth) cloth.wake();
};

collisionPresetSelect.onchange = () => {
    const preset = collisionPresets[collisionPresetSelect.value];
    if (!preset) return;
    // 选了碰撞预设就顺手打开自碰撞，否则改了参数也看不出效果
    if (!collisionEnabled) { collisionEnabled = true; toggleCollision.checked = true; }
    collisionRadiusSlider.value = preset.radius;
    collisionForceSlider.value = preset.force;
    collisionItersSlider.value = preset.iters;
    document.getElementById("collisionRadiusValue").textContent = parseFloat(preset.radius).toFixed(2);
    document.getElementById("collisionForceValue").textContent = parseFloat(preset.force).toFixed(1);
    document.getElementById("collisionItersValue").textContent = parseInt(preset.iters);
    if (cloth) cloth.wake();
};

dragModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.checked) {
            dragMode = e.target.value;
            const showRadius = dragMode === "area" || dragMode === "multi" || dragMode === "tear";
            dragRadiusCtrl.style.display = showRadius ? "grid" : "none";
            knifeRadiusCtrl.style.display = (dragMode === "knife") ? "grid" : "none";
            if (maxDragDistanceCtrl) { maxDragDistanceCtrl.style.display = (dragMode === "tear") ? "none" : "grid"; }
            if (tearSettingsGroup) { tearSettingsGroup.style.display = (dragMode === "tear") ? "block" : "none"; }
            endDrag();
            multiTouchMap.forEach((data, id) => endMultiDrag(id));
        }
    });
});

if (dragDepthSelect) { dragDepthSelect.onchange = () => { dragDepthMode = dragDepthSelect.value; }; }
if (tearPresetSelect) {
    tearPresetSelect.onchange = () => {
        const val = tearPresetSelect.value;
        if (val !== "custom" && tearPresets[val] !== undefined) {
            tearThresholdSlider.value = tearPresets[val];
            document.getElementById("tearThresholdValue").textContent = parseFloat(tearPresets[val]).toFixed(2);
        }
    };
}
if (tearThresholdSlider) {
    tearThresholdSlider.oninput = () => {
        document.getElementById("tearThresholdValue").textContent = parseFloat(tearThresholdSlider.value).toFixed(2);
        tearPresetSelect.value = "custom";
    };
}

clothColorInput.oninput = () => {
    currentClothColor = clothColorInput.value;
    materialPresetSelect.value = "custom";
    if (clothMesh && !textureEnabled) {
        switchClothMaterial();
        if (clothMesh) clothMesh.material.wireframe = showGrid;
    }
};

function createEnvMap(baseColorHex = null) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const c = canvas.getContext("2d");

    if (baseColorHex) {
        const baseColor = new THREE.Color(baseColorHex);
        const hsl = {};
        baseColor.getHSL(hsl);

        const topColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.min(1.0, hsl.l + 0.2));
        const midColor = baseColor.clone();
        const botColor = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.0, hsl.l - 0.3));

        const grad = c.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, `#${topColor.getHexString()}`);
        grad.addColorStop(0.5, `#${midColor.getHexString()}`);
        grad.addColorStop(1, `#${botColor.getHexString()}`);
        c.fillStyle = grad;
        c.fillRect(0, 0, canvas.width, canvas.height);

        const sunGrad = c.createRadialGradient(256, 50, 0, 256, 50, 150);
        sunGrad.addColorStop(0, "rgba(255, 255, 255, 0.3)");
        sunGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        c.fillStyle = sunGrad;
        c.fillRect(0, 0, canvas.width, canvas.height);
    } else {
        const grad = c.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, "#f0f5ff");
        grad.addColorStop(0.5, "#d0d5e0");
        grad.addColorStop(1, "#606060");
        c.fillStyle = grad;
        c.fillRect(0, 0, canvas.width, canvas.height);

        const sunGrad = c.createRadialGradient(256, 50, 0, 256, 50, 150);
        sunGrad.addColorStop(0, "rgba(255, 255, 255, 0.7)");
        sunGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        c.fillStyle = sunGrad;
        c.fillRect(0, 0, canvas.width, canvas.height);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function updateEnvironment() {
    if (!scene) return;
    if (scene.environment) { scene.environment.dispose(); }
    if (bgEnvReflectEnabled) {
        scene.environment = createEnvMap(bgColorInput.value);
    } else {
        scene.environment = createEnvMap();
    }
}

toggleBgEnv.onchange = () => {
    bgEnvReflectEnabled = toggleBgEnv.checked;
    updateEnvironment();
};

function updateBgTransform() {
    const scale = parseFloat(bgScaleSlider.value) / 100;
    const x = parseFloat(bgXSlider.value);
    const y = parseFloat(bgYSlider.value);
    bgImage.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(${scale})`;
    document.getElementById("bgScaleValue").textContent = Math.round(scale * 100) + "%";
    document.getElementById("bgXValue").textContent = x + "px";
    document.getElementById("bgYValue").textContent = y + "px";
}

bgScaleSlider.oninput = updateBgTransform;
bgXSlider.oninput = updateBgTransform;
bgYSlider.oninput = updateBgTransform;

bgColorInput.oninput = () => {
    bgLayer.style.backgroundColor = bgColorInput.value;
    if (bgEnvReflectEnabled) updateEnvironment();
};

bgImageInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;

    if (currentBgImageUrl) URL.revokeObjectURL(currentBgImageUrl);
    currentBgImageUrl = URL.createObjectURL(file);

    bgImage.src = currentBgImageUrl;
    bgImage.style.display = "block";
    bgLayer.style.backgroundColor = "transparent";

    if (bgEnvReflectEnabled) {
        toggleBgEnv.checked = false;
        bgEnvReflectEnabled = false;
        updateEnvironment();
    }
};

resetBgBtn.onclick = () => {
    bgColorInput.value = "#ffffff";
    bgLayer.style.backgroundColor = "#ffffff";
    bgImage.style.display = "none";
    bgImage.src = "";
    if (currentBgImageUrl) URL.revokeObjectURL(currentBgImageUrl);
    currentBgImageUrl = null;
    bgImageInput.value = "";
    bgScaleSlider.value = 100;
    bgXSlider.value = 0;
    bgYSlider.value = 0;
    toggleBgEnv.checked = false;
    bgEnvReflectEnabled = false;
    updateEnvironment();
    updateBgTransform();
};

flipHBtn.onclick = () => { flipH = !flipH; refreshImageTexture(); redrawPreview(); };
flipVBtn.onclick = () => { flipV = !flipV; refreshImageTexture(); redrawPreview(); };

function applyTextureFilter(canvas, type, strength = 1.0) {
    if (type === 'none' || !canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width;
    const h = canvas.height;

    const srcData = ctx.getImageData(0, 0, w, h);
    const src = srcData.data;
    const outData = ctx.createImageData(w, h);
    const out = outData.data;

    if (type === 'tie_dye') {
        const numPoints = 3 + Math.floor(Math.random() * 3);
        const points = [];
        for(let i=0; i<numPoints; i++){
            points.push({
                cx: (0.2 + Math.random() * 0.6) * w,
                cy: (0.2 + Math.random() * 0.6) * h,
                freq: 0.01 + Math.random() * 0.02,
                phase: Math.random() * Math.PI * 2,
                tintR: 0.85 + Math.random() * 0.3,
                tintG: 0.85 + Math.random() * 0.3,
                tintB: 0.85 + Math.random() * 0.3
            });
        }

        const s = strength;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                let totalDx = 0, totalDy = 0;
                let colorMixR = 0, colorMixG = 0, colorMixB = 0;
                let weightSum = 0;

                for(let i=0; i<numPoints; i++) {
                    const p = points[i];
                    const ddx = x - p.cx;
                    const ddy = y - p.cy;
                    const dist = Math.sqrt(ddx*ddx + ddy*ddy) || 0.1;

                    const wave = Math.sin(dist * p.freq * 10 + p.phase);
                    const t = (wave + 1) * 0.5;
                    const mask = t * t * (3 - 2 * t);

                    const force = wave * s * 1.5;
                    totalDx += (ddx / dist) * force;
                    totalDy += (ddy / dist) * force;

                    const weight = 1.0 / (1.0 + dist * 0.003);
                    const mixVal = mask * s * weight;
                    colorMixR += mixVal * (p.tintR - 1);
                    colorMixG += mixVal * (p.tintG - 1);
                    colorMixB += mixVal * (p.tintB - 1);
                    weightSum += weight;
                }

                let srcX = Math.floor(x + totalDx);
                let srcY = Math.floor(y + totalDy);
                srcX = srcX < 0 ? 0 : (srcX >= w ? w - 1 : srcX);
                srcY = srcY < 0 ? 0 : (srcY >= h ? h - 1 : srcY);

                const srcIdx = (srcY * w + srcX) * 4;
                let r = src[srcIdx], g = src[srcIdx+1], b = src[srcIdx+2];

                if (weightSum > 0) {
                    const maxOffset = 0.4;
                    const offR = Math.max(-maxOffset, Math.min(maxOffset, colorMixR / weightSum));
                    const offG = Math.max(-maxOffset, Math.min(maxOffset, colorMixG / weightSum));
                    const offB = Math.max(-maxOffset, Math.min(maxOffset, colorMixB / weightSum));
                    r = r * (1 + offR); g = g * (1 + offG); b = b * (1 + offB);
                }
                out[idx] = Math.max(0, Math.min(255, r));
                out[idx+1] = Math.max(0, Math.min(255, g));
                out[idx+2] = Math.max(0, Math.min(255, b));
                out[idx+3] = 255;
            }
        }
    } else if (type === 'batik') {
        if (strength <= 0.01) {
            outData.data.set(srcData.data);
            ctx.putImageData(outData, 0, 0);
            return;
        }

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r = src[idx], g = src[idx+1], b = src[idx+2];

                const n1 = Math.sin(x * 0.008) * Math.cos(y * 0.008) + Math.sin((x+y) * 0.012);
                const n2 = Math.sin(x * 0.03) * Math.cos(y * 0.02);
                const edgeNoise = (Math.sin(x * 0.2) * Math.cos(y * 0.15)) * 0.1;

                const cellField = n1 + n2 * 0.3 + edgeNoise;

                const crack1 = Math.abs(Math.sin(x * 0.08 + y * 0.05) * Math.cos(y * 0.08 - x * 0.05));
                const crack2 = Math.abs(Math.sin(x * 0.2 + y * 0.1) * Math.cos(y * 0.2 - x * 0.1));
                const crackField = crack1 * 0.7 + crack2 * 0.3;

                const isInsideBlock = cellField > -0.1;
                const isCrack = isInsideBlock && (crackField < 0.04 + strength * 0.02);

                if (isCrack) {
                    out[idx] = 10;
                    out[idx+1] = 20;
                    out[idx+2] = 40;
                } else {
                    const mix = Math.min(1.0, strength * 1.2);
                    if (cellField > 0) {
                        out[idx] = r * (1 - mix) + 25 * mix;
                        out[idx+1] = g * (1 - mix) + 75 * mix;
                        out[idx+2] = b * (1 - mix) + 160 * mix;
                    } else {
                        out[idx] = r * (1 - mix * 0.5) + 220 * mix * 0.5;
                        out[idx+1] = g * (1 - mix * 0.5) + 230 * mix * 0.5;
                        out[idx+2] = b * (1 - mix * 0.5) + 250 * mix * 0.5;
                    }
                }
                out[idx+3] = 255;
            }
        }
    } else if (type === 'ink') {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r = src[idx], g = src[idx+1], b = src[idx+2];

                const gray = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
                const noise = Math.sin(x * 0.02) * Math.cos(y * 0.02) + Math.sin((x+y) * 0.015) * 0.8;

                let inkEffect = Math.max(0, 1.0 - gray * 1.2 - noise * 0.5);
                const finalInk = Math.min(1, inkEffect * strength * 2.5);

                const inkR = 20, inkG = 20, inkB = 25;
                out[idx] = r * (1 - finalInk) + inkR * finalInk;
                out[idx+1] = g * (1 - finalInk) + inkG * finalInk;
                out[idx+2] = b * (1 - finalInk) + inkB * finalInk;
                out[idx+3] = 255;
            }
        }
    } else if (type === 'silk') {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r = src[idx], g = src[idx+1], b = src[idx+2];

                const diag = (x - y) / (w + h);
                const wave = Math.sin(diag * Math.PI * 8);

                const highlight = Math.max(0, wave) * 220 * strength;
                const shadow = Math.max(0, -wave) * 90 * strength;

                out[idx] = Math.max(0, Math.min(255, r + highlight - shadow));
                out[idx+1] = Math.max(0, Math.min(255, g + highlight - shadow));
                out[idx+2] = Math.max(0, Math.min(255, b + highlight - shadow));
                out[idx+3] = 255;
            }
        }
    } else if (type === 'vintage') {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                let nr = src[idx] * (1 + strength * 0.5);
                let ng = src[idx+1] * (1 - strength * 0.2);
                let nb = src[idx+2] * (1 - strength * 0.8);

                const dist = Math.hypot(x - w/2, y - h/2) / Math.max(w, h);
                const vignette = 1 - Math.max(0, dist - 0.1) * 3.0 * strength;

                nr *= Math.max(0, vignette);
                ng *= Math.max(0, vignette);
                nb *= Math.max(0, vignette);

                const grain = (Math.random() - 0.5) * 100 * strength;

                out[idx] = Math.max(0, Math.min(255, nr + grain));
                out[idx+1] = Math.max(0, Math.min(255, ng + grain));
                out[idx+2] = Math.max(0, Math.min(255, nb + grain));
                out[idx+3] = 255;
            }
        }
    } else if (type === 'denim') {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const stripe = Math.sin((x - y) * 0.1) * Math.cos(x * 0.05);
                const whiteWash = Math.max(0, stripe) * 200 * strength;
                out[idx] = Math.min(255, src[idx] + whiteWash);
                out[idx+1] = Math.min(255, src[idx+1] + whiteWash);
                out[idx+2] = Math.min(255, src[idx+2] + whiteWash);
                out[idx+3] = 255;
            }
        }
    } else if (type === 'holographic') {
    const t = Date.now() * 0.0002;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = src[idx], g = src[idx+1], b = src[idx+2];
            // 加入时间，条纹缓慢滑动
            const hue = ((x * 2.0 + y * 2.5 + t * 80) + Math.sin(x * 0.01 + t) * 360) % 360;
            const s = 1.0, l = 0.6;
            const c = (1 - Math.abs(2 * l - 1)) * s;
            const x2 = c * (1 - Math.abs((hue / 60) % 2 - 1));
            const m = l - c / 2;
            let hr = 0, hg = 0, hb = 0;
            if (hue >= 0 && hue < 60) { hr = c; hg = x2; hb = 0; }
            else if (hue >= 60 && hue < 120) { hr = x2; hg = c; hb = 0; }
            else if (hue >= 120 && hue < 180) { hr = 0; hg = c; hb = x2; }
            else if (hue >= 180 && hue < 240) { hr = 0; hg = x2; hb = c; }
            else if (hue >= 240 && hue < 300) { hr = x2; hg = 0; hb = c; }
            else { hr = c; hg = 0; hb = x2; }
            out[idx] = Math.min(255, r + (hr + m) * 255 * strength);
            out[idx+1] = Math.min(255, g + (hg + m) * 255 * strength);
            out[idx+2] = Math.min(255, b + (hb + m) * 255 * strength);
            out[idx+3] = 255;
        }
    }
    } else if (type === 'sun_faded') {
        // ☀️ 晒褪色：降饱和 + 暖黄 + 轻微暗角，像在窗边放了三年
        const s = strength;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r = src[idx], g = src[idx+1], b = src[idx+2];
                const gray = r * 0.299 + g * 0.587 + b * 0.114;
                const desat = 1 - 0.55 * s;
                let nr = (r * desat + gray * (1 - desat)) * (1 + 0.10 * s) + 18 * s;
                let ng = (g * desat + gray * (1 - desat)) * (1 + 0.08 * s) + 10 * s;
                let nb = (b * desat + gray * (1 - desat)) * (1 - 0.06 * s) - 6 * s;
                const nx = x / w - 0.5, ny = y / h - 0.5;
                const vig = 1 - Math.max(0, Math.sqrt(nx*nx + ny*ny) - 0.28) * 1.1 * s;
                nr *= vig; ng *= vig; nb *= vig;
                out[idx] = Math.max(0, Math.min(255, nr));
                out[idx+1] = Math.max(0, Math.min(255, ng));
                out[idx+2] = Math.max(0, Math.min(255, nb));
                out[idx+3] = 255;
            }
        }
    } else if (type === 'wet_stain') {
        // 💧 湿痕：不规则暗斑 + 边缘压深，像刚被水洇过
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const n1 = Math.sin(x * 0.012 + Math.cos(y * 0.009) * 2.0);
                const n2 = Math.sin(y * 0.017 + Math.sin(x * 0.011) * 1.7);
                const field = (n1 + n2) * 0.5;
                const wet = Math.max(0, field) * 0.75 * strength;
                const edge = Math.abs(field) * strength;
                const dark = 1 - wet * 0.45;
                out[idx] = Math.max(0, Math.min(255, src[idx] * dark - edge * 12));
                out[idx+1] = Math.max(0, Math.min(255, src[idx+1] * dark - edge * 10));
                out[idx+2] = Math.max(0, Math.min(255, src[idx+2] * dark * 1.04));
                out[idx+3] = 255;
            }
        }
    } else if (type === 'knit_grain') {
        // 🧶 针织纹理：细密线圈 + 轻微明暗起伏
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const row = Math.sin(y * 0.55) * 0.5 + 0.5;
                const col = Math.sin(x * 0.09 + row * 2.0) * 0.5 + 0.5;
                const shade = (row * 0.55 + col * 0.45 - 0.5) * 70 * strength;
                out[idx] = Math.max(0, Math.min(255, src[idx] + shade));
                out[idx+1] = Math.max(0, Math.min(255, src[idx+1] + shade));
                out[idx+2] = Math.max(0, Math.min(255, src[idx+2] + shade * 0.9));
                out[idx+3] = 255;
            }
        }
    } else if (type === 'film_grain') {
        // 🎞 胶片颗粒：单色噪点 + 轻微对比拉伸
        const s = strength;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const grain = (Math.random() - 0.5) * 90 * s;
                const contrast = 1 + 0.25 * s;
                const lift = -(0.10 * s) * 255;
                out[idx] = Math.max(0, Math.min(255, (src[idx] - 128) * contrast + 128 + lift + grain));
                out[idx+1] = Math.max(0, Math.min(255, (src[idx+1] - 128) * contrast + 128 + lift + grain));
                out[idx+2] = Math.max(0, Math.min(255, (src[idx+2] - 128) * contrast + 128 + lift + grain));
                out[idx+3] = 255;
            }
        }
    } else {
        outData.data.set(srcData.data);
    }

    ctx.putImageData(outData, 0, 0);
}

function refreshImageTexture() {
    if (!loadedImage) return;
    const tmpCanvas = document.createElement("canvas");

    tmpCanvas.width = loadedImage.width;
    tmpCanvas.height = loadedImage.height;

    const tctx = tmpCanvas.getContext("2d", { willReadFrequently: true });
    tctx.fillStyle = "#ffffff";
    tctx.fillRect(0, 0, tmpCanvas.width, tmpCanvas.height);

    tctx.save();
    if (flipH) { tctx.translate(tmpCanvas.width, 0); tctx.scale(-1, 1); }
    if (flipV) { tctx.translate(0, tmpCanvas.height); tctx.scale(1, -1); }
    tctx.drawImage(loadedImage, 0, 0);
    tctx.restore();

    applyTextureFilter(tmpCanvas, currentFilterType, currentFilterStrength);

    if (imageTexture) {
        imageTexture.dispose();
    }
    imageTexture = new THREE.Texture(tmpCanvas);
    imageTexture.wrapS = THREE.ClampToEdgeWrapping;
    imageTexture.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in imageTexture) imageTexture.colorSpace = THREE.SRGBColorSpace;
    // 🎥 各向异性过滤：布料在 3D 视角里经常是斜看过去（掠射角），
    // 只靠双线性 mipmap 会在斜角上把印花拖成一片糊 / 出现莫尔条纹，
    // 看起来就像"贴图撕裂"。开到显卡上限（通常 16×）只在采样阶段多花极少的代价。
    if (renderer && renderer.capabilities) {
        imageTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    imageTexture.needsUpdate = true;

    if (thicknessEnabled) updateThicknessMesh();
}

// 🎥 弱透视相机参数：参考 Blender 视图的"接近正交"手感
//    fov 越小、相机越远 → 近大远小越弱。17° ≈ 长焦镜头，1.3 世界单位的物体
//    在 8.7 单位外，边缘和中心的透视差异不到 3%，看起来几乎是平直的正视图。
const WEAK_FOV_DEG = 17;
const WEAK_FOV_RAD = WEAK_FOV_DEG * Math.PI / 180;

function updateCamera() {
    zoom = parseFloat(zoomSlider.value);
    camX = parseFloat(camXSlider.value);
    camY = parseFloat(camYSlider.value);

    if (!camera) return;

    const aspect = CANVAS_W / Math.max(1, CANVAS_H);
    // 缩到 0 时给一个极小尺寸，避免投影矩阵退化（画面会变成空白但不报错）
    const size = 1.3 * Math.max(zoom, 0.002);

    if (camera.isPerspectiveCamera) {
        // 需要显示的"半高"（世界单位）→ 由 fov 反推相机距离，二者一一对应，
        // 所以缩放（推拉）只改变距离，透视强度保持不变（不会越放大越夸张）。
        const halfH = (aspect >= 1) ? size : size / aspect;
        camera.fov = WEAK_FOV_DEG;
        camera.aspect = aspect;
        camera.near = 0.05;
        camera.far = 400;
        camZ = halfH / Math.tan(WEAK_FOV_RAD / 2);
    } else {
        if (aspect >= 1) {
            camera.left = -size * aspect; camera.right = size * aspect;
            camera.top = size; camera.bottom = -size;
        } else {
            camera.left = -size; camera.right = size;
            camera.top = size / aspect; camera.bottom = -size / aspect;
        }
        camZ = 3;
    }
    camera.position.set(camX, camY, camZ);
    camera.updateProjectionMatrix();
}

resetCamBtn.onclick = () => {
    zoomSlider.value = 1;
    camXSlider.value = 0;
    camYSlider.value = 0;
    document.getElementById("zoomValue").textContent = "1.00";
    document.getElementById("camXValue").textContent = "0.00";
    document.getElementById("camYValue").textContent = "0.00";
    updateCamera();
};

function updateLightPosition() {
    const lx = parseFloat(lightXSlider.value);
    const ly = parseFloat(lightYSlider.value);
    const lz = parseFloat(lightZSlider.value);

    if (dirLight) dirLight.position.set(lx, ly, lz);
}

resetLightPosBtn.onclick = () => {
    lightXSlider.value = 2;
    lightYSlider.value = 4.5;
    lightZSlider.value = 5;
    updateLightPosition();
};

lightColorInput.oninput = () => {
    if (dirLight) dirLight.color.set(lightColorInput.value);
};

toggleShadow.onchange = () => {
    shadowEnabled = toggleShadow.checked;
    if (shadowEnabled && !lightEnabled) {
        toggleLight.checked = true;
        toggleLight.dispatchEvent(new Event('change'));
    }
    if (dirLight) dirLight.castShadow = shadowEnabled;
    if (clothMesh) clothMesh.castShadow = shadowEnabled;
    if (thicknessMesh) thicknessMesh.castShadow = shadowEnabled;
    if (outlineMesh) outlineMesh.castShadow = shadowEnabled;
    // 🟫 地面：开阴影时显示（此时能看到投影；地板本身也可见）
    if (groundMesh) groundMesh.visible = shadowEnabled;
    if (groundShadowMesh) groundShadowMesh.visible = shadowEnabled;
    if (backWallMesh) backWallMesh.visible = shadowEnabled;
};

thicknessColorInput.oninput = () => {
    if (thicknessMat && !thicknessTexEnabled) thicknessMat.color.set(thicknessColorInput.value);
};

outlineColorInput.oninput = () => {
    if (outlineMat) outlineMat.color.set(outlineColorInput.value);
};

function createProceduralNormalMap(type) {
    const res = 512;
    const n = 4;
    const canvas = document.createElement('canvas');
    canvas.width = res; canvas.height = res;
    const ctx = canvas.getContext('2d');

    const hCanvas = document.createElement('canvas');
    hCanvas.width = res; hCanvas.height = res;
    const hCtx = hCanvas.getContext('2d');

    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, res, res);

    const step = res / n;

    if (type === 'batik') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for(let i=0; i<res; i+=4) {
            hCtx.fillStyle = 'rgba(255,255,255,0.05)';
            hCtx.fillRect(0, i, res, 2);
            hCtx.fillRect(i, 0, 2, res);
        }
        hCtx.strokeStyle = '#303030'; 
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';
        for(let i=0; i<60; i++) {
            let x = Math.random() * res;
            let y = Math.random() * res;
            const segments = Math.floor(Math.random() * 4) + 2;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            let angle = Math.random() * Math.PI * 2;
            for(let j=0; j<segments; j++) {
                x += Math.cos(angle) * (Math.random() * 20 + 10);
                y += Math.sin(angle) * (Math.random() * 20 + 10);
                hCtx.lineTo(x, y);
                angle += (Math.random() - 0.5) * 1.5; 
            }
            hCtx.lineWidth = Math.random() * 1.5 + 0.5;
            hCtx.stroke();
            for(let k=0; k<2; k++) {
                let bx = x, by = y;
                let bAngle = angle + (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 0.8 + 0.4);
                hCtx.beginPath();
                hCtx.moveTo(bx, by);
                for(let j=0; j<2; j++) {
                    bx += Math.cos(bAngle) * (Math.random() * 15 + 5);
                    by += Math.sin(bAngle) * (Math.random() * 15 + 5);
                    hCtx.lineTo(bx, by);
                    bAngle += (Math.random() - 0.5) * 1.0;
                }
                hCtx.lineWidth = Math.random() * 1.0 + 0.5;
                hCtx.stroke();
            }
        }
    } else if (type === 'washed_cotton') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const grid = res / 32; 
        hCtx.strokeStyle = 'rgba(255,255,255,0.3)';
        hCtx.lineWidth = 2;
        for(let i=0; i<32; i++) {
            hCtx.beginPath(); hCtx.moveTo(i*grid, 0); hCtx.lineTo(i*grid, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(0, i*grid); hCtx.lineTo(res, i*grid); hCtx.stroke();
        }
        for(let i=0; i<200; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * 15 + 5;
            hCtx.beginPath();
            hCtx.arc(x, y, r, Math.random()*Math.PI, Math.random()*Math.PI + Math.PI/2);
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)';
            hCtx.lineWidth = Math.random() * 3 + 1;
            hCtx.stroke();
        }
        for(let i=0; i<8000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const v = Math.random() > 0.5 ? 255 : 0;
            hCtx.fillStyle = `rgba(${v},${v},${v},0.15)`;
            hCtx.beginPath();
            hCtx.arc(x, y, Math.random() * 1.5 + 0.5, 0, Math.PI * 2);
            hCtx.fill();
        }
    } else if (type === 'polyester') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = '#a0a0a0';
        hCtx.lineWidth = 2;
        for(let i=0; i<32; i++) {
            hCtx.beginPath(); hCtx.moveTo(i*step, 0); hCtx.lineTo(i*step, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(0, i*step); hCtx.lineTo(res, i*step); hCtx.stroke();
        }
        for(let i=0; i<2000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            hCtx.fillStyle = `rgba(255,255,255,${Math.random()*0.3})`;
            hCtx.fillRect(x, y, Math.random()*3+1, 1);
        }
    } else if (type === 'tr_blend') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for(let i=-res; i<res*2; i+=6) {
            hCtx.beginPath();
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
            hCtx.lineWidth = 2;
            hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res);
            hCtx.stroke();
        }
        for(let i=0; i<10000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
            hCtx.fillRect(x, y, 1, 2);
        }
    } else if (type === 'worsted_wool') {
        hCtx.fillStyle = '#707070';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for(let i=-res; i<res*2; i+=4) {
            hCtx.beginPath();
            hCtx.strokeStyle = (i % 8 === 0) ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)';
            hCtx.lineWidth = 2.5;
            hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res);
            hCtx.stroke();
        }
        for(let i=0; i<5000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            hCtx.fillStyle = `rgba(255,255,255,${Math.random()*0.08})`;
            hCtx.beginPath();
            hCtx.arc(x, y, Math.random()*1.5, 0, Math.PI*2);
            hCtx.fill();
        }
    } else if (type === 'stripe') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = res / 16; 
        hCtx.lineCap = "round";
        for(let i=-2; i<res/(res/16)+2; i++) {
            hCtx.beginPath();
            hCtx.strokeStyle = (i%2===0) ? "#ffffff" : "#000000";
            hCtx.moveTo(0, i*res/16);
            hCtx.lineTo(res, i*res/16);
            hCtx.stroke();
        }
    } else if (type === 'weave') {
        // 经典平纹：经纬线一上一下交替，满幅铺满
        const WC = 24;
        const wStep = res / WC;
        const wHalf = wStep * 0.30;
        hCtx.fillStyle = '#787878';
        hCtx.fillRect(0, 0, res, res);
        for (let row = 0; row < WC; row++) {
            const y = row * wStep + wStep / 2;
            for (let col = 0; col < WC; col++) {
                const onTop = ((row + col) % 2) === 0;
                const x = col * wStep;
                const grad = hCtx.createLinearGradient(0, y - wHalf, 0, y + wHalf);
                grad.addColorStop(0, onTop ? 'rgba(40,40,40,0.50)' : 'rgba(255,255,255,0.55)');
                grad.addColorStop(0.45, 'rgba(238,238,238,0.85)');
                grad.addColorStop(0.55, 'rgba(210,210,210,0.90)');
                grad.addColorStop(1, onTop ? 'rgba(255,255,255,0.55)' : 'rgba(40,40,40,0.50)');
                hCtx.fillStyle = grad;
                hCtx.fillRect(x - 1, y - wHalf, wStep + 2, wHalf * 2);
            }
        }
        for (let col = 0; col < WC; col++) {
            const x = col * wStep + wStep / 2;
            for (let row = 0; row < WC; row++) {
                const onTop = ((row + col) % 2) === 1;
                const y = row * wStep;
                const grad = hCtx.createLinearGradient(x - wHalf, 0, x + wHalf, 0);
                grad.addColorStop(0, onTop ? 'rgba(40,40,40,0.50)' : 'rgba(255,255,255,0.55)');
                grad.addColorStop(0.5, 'rgba(232,232,232,0.88)');
                grad.addColorStop(1, onTop ? 'rgba(255,255,255,0.55)' : 'rgba(40,40,40,0.50)');
                hCtx.fillStyle = grad;
                hCtx.fillRect(x - wHalf, y - 1, wHalf * 2, wStep + 2);
            }
        }
    } else if (type === 'herringbone') {
        // 人字纹：一条连续的人字形折线（全部同向），行与行交错 —— 没有接缝
        const HC = 9;
        const hw = res / HC;           // 半周期宽度
        const hh = hw * 1.9;           // 折线高度
        const rowGap = hh * 0.62;      // 行间距（密度）
        hCtx.fillStyle = '#7c7c7c';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';

        // 每一行画成一条不断开的连续折线（V 全部同向朝上）
        const drawChevronRow = (baseY, shiftX, w, color, lw) => {
            hCtx.strokeStyle = color;
            hCtx.lineWidth = lw;
            hCtx.beginPath();
            let x = -hw * 2 + shiftX;
            let up = false;
            hCtx.moveTo(x, baseY);
            while (x < res + hw * 2) {
                x += hw;
                up = !up;
                hCtx.lineTo(x, up ? baseY - hh : baseY);
            }
            hCtx.stroke();
        };

        const rows = Math.ceil(res / rowGap) + 4;
        for (let r = -3; r <= rows; r++) {
            const baseY = r * rowGap;
            const shiftX = (r % 2 === 0) ? 0 : hw * 0.5;
            // 暗沟（最宽，作为两股之间的凹陷）
            drawChevronRow(baseY, shiftX, hw, 'rgba(32,32,32,0.72)', hw * 0.55);
            // 主线（亮）
            drawChevronRow(baseY, shiftX, hw, 'rgba(232,232,232,0.96)', hw * 0.34);
            // 顶部高光（细）
            drawChevronRow(baseY - hw * 0.10, shiftX, hw, 'rgba(255,255,255,0.55)', hw * 0.10);
        }
        // 纱线噪点
        for (let i = 0; i < 2600; i++) {
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)';
            hCtx.fillRect(Math.random() * res, Math.random() * res, 1.4, 1.4);
        }
    } else if (type === 'basket') {
        // 编织纹：2×2 交替的横/竖条编织，每格三根圆棱
        const BM = 8;
        const bStep = res / BM;
        hCtx.fillStyle = '#7b7b7b';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for (let gx = 0; gx < BM; gx++) {
            for (let gy = 0; gy < BM; gy++) {
                const horiz = ((gx + gy) % 2) === 0;
                const x0 = gx * bStep;
                const y0 = gy * bStep;
                for (let k = 0; k < 3; k++) {
                    const t = (k + 0.5) / 3;
                    const cs = bStep * 0.32;
                    if (horiz) {
                        const y = y0 + bStep * t;
                        const grad = hCtx.createLinearGradient(0, y - bStep * 0.20, 0, y + bStep * 0.20);
                        grad.addColorStop(0, 'rgba(35,35,35,0.55)');
                        grad.addColorStop(0.42, 'rgba(248,248,248,0.92)');
                        grad.addColorStop(1, 'rgba(60,60,60,0.45)');
                        hCtx.fillStyle = grad;
                        hCtx.beginPath();
                        hCtx.roundRect ? hCtx.roundRect(x0, y - bStep * 0.20, bStep, bStep * 0.40, bStep * 0.18) : hCtx.rect(x0, y - bStep * 0.20, bStep, bStep * 0.40);
                        hCtx.fill();
                    } else {
                        const x = x0 + bStep * t;
                        const grad = hCtx.createLinearGradient(x - bStep * 0.20, 0, x + bStep * 0.20, 0);
                        grad.addColorStop(0, 'rgba(35,35,35,0.55)');
                        grad.addColorStop(0.5, 'rgba(248,248,248,0.92)');
                        grad.addColorStop(1, 'rgba(60,60,60,0.45)');
                        hCtx.fillStyle = grad;
                        hCtx.beginPath();
                        hCtx.roundRect ? hCtx.roundRect(x - bStep * 0.20, y0, bStep * 0.40, bStep, bStep * 0.18) : hCtx.rect(x - bStep * 0.20, y0, bStep * 0.40, bStep);
                        hCtx.fill();
                    }
                }
            }
        }
    } else if (type === 'puffyQuilt') {
        const W = res / 2;
        const H = res / 2;
        const cols = res / W;
        const rows = res / (H / 2);
        hCtx.fillStyle = '#151515';
        hCtx.fillRect(0, 0, res, res);
        const drawDiamond = (cx, cy, w, h, r) => {
            hCtx.beginPath();
            hCtx.moveTo(cx, cy - h/2 + r);
            hCtx.quadraticCurveTo(cx, cy - h/2, cx + r*0.7, cy - h/2 + r*0.7);
            hCtx.lineTo(cx + w/2 - r*0.7, cy - r*0.7);
            hCtx.quadraticCurveTo(cx + w/2, cy, cx + w/2 - r*0.7, cy + r*0.7);
            hCtx.lineTo(cx + r*0.7, cy + h/2 - r*0.7);
            hCtx.quadraticCurveTo(cx, cy + h/2, cx - r*0.7, cy + h/2 - r*0.7);
            hCtx.lineTo(cx - w/2 + r*0.7, cy + r*0.7);
            hCtx.quadraticCurveTo(cx - w/2, cy, cx - w/2 + r*0.7, cy - r*0.7);
            hCtx.lineTo(cx - r*0.7, cy - h/2 + r*0.7);
            hCtx.quadraticCurveTo(cx, cy - h/2, cx, cy - h/2 + r);
            hCtx.closePath();
        };
        for (let j = -2; j <= rows + 2; j++) {
            const offsetX = (j % 2 === 0) ? 0 : W / 2;
            for (let i = -2; i <= cols + 2; i++) {
                const cx = i * W + W/2 + offsetX;
                const cy = j * H/2 + H/2;
                const w = W * 0.95;
                const h = H * 0.95;
                const r = W * 0.15;
                const grad = hCtx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.6);
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.2, '#f5f5f5');
                grad.addColorStop(0.5, '#e0e0e0'); 
                grad.addColorStop(1, '#202020');   
                hCtx.fillStyle = grad;
                drawDiamond(cx, cy, w, h, r);
                hCtx.fill();
                hCtx.strokeStyle = '#404040';
                hCtx.lineWidth = 4; 
                hCtx.stroke();
                const points = [ { x: cx - w/2, y: cy } ];
                for (const p of points) {
                    const btnR = W * 0.08;
                    const pitGrad = hCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, btnR * 1.8);
                    pitGrad.addColorStop(0, '#000000');
                    pitGrad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
                    pitGrad.addColorStop(1, 'rgba(0,0,0,0)');
                    hCtx.fillStyle = pitGrad;
                    hCtx.beginPath(); hCtx.arc(p.x, p.y, btnR * 1.8, 0, Math.PI * 2); hCtx.fill();
                    const btnGrad = hCtx.createRadialGradient(p.x - btnR*0.2, p.y - btnR*0.2, 0, p.x, p.y, btnR);
                    btnGrad.addColorStop(0, '#a0a0a0');
                    btnGrad.addColorStop(1, '#404040');
                    hCtx.fillStyle = btnGrad;
                    hCtx.beginPath(); hCtx.arc(p.x, p.y, btnR, 0, Math.PI * 2); hCtx.fill();
                    hCtx.strokeStyle = '#ffffff'; 
                    hCtx.lineCap = 'round';
                    hCtx.lineJoin = 'round';
                    hCtx.lineWidth = btnR * 0.2;
                    hCtx.beginPath();
                    hCtx.arc(p.x, p.y, btnR * 0.75, 0, Math.PI * 2);
                    hCtx.stroke();
                    hCtx.fillStyle = '#ffffff';
                    const rx = btnR * 0.3; 
                    const maxR = btnR * 0.12; 
                    const drawTaperedLine = (ctx, x1, y1, x2, y2, maxW) => {
                        const steps = 15;
                        for (let i = 0; i <= steps; i++) {
                            const t = i / steps;
                            const x = x1 + (x2 - x1) * t;
                            const y = y1 + (y2 - y1) * t;
                            const rad = Math.sin(t * Math.PI) * maxW;
                            if (rad > 0) {
                                ctx.beginPath();
                                ctx.arc(x, y, rad, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        }
                    };
                    drawTaperedLine(hCtx, p.x - rx, p.y - rx, p.x + rx, p.y + rx, maxR);
                    drawTaperedLine(hCtx, p.x + rx, p.y - rx, p.x - rx, p.y + rx, maxR);
                }
            }
        }
    } else if (type === 'vinyl_banner') {
        // 🖨 喷绘布：细密平织底纹 + 喷墨颗粒
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = 'rgba(255,255,255,0.20)';
        hCtx.lineWidth = 1;
        for (let i = 0; i < res; i += 6) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(0, i); hCtx.lineTo(res, i); hCtx.stroke();
        }
        for (let i = 0; i < 2600; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.28)';
            hCtx.beginPath(); hCtx.arc(x, y, Math.random() * 1.6 + 0.4, 0, Math.PI * 2); hCtx.fill();
        }
    } else if (type === 'bubble_wrap') {
        // 🫧 气泡膜：规则排列的圆形气泡
        hCtx.fillStyle = '#6a6a6a';
        hCtx.fillRect(0, 0, res, res);
        const bStep = res / 8;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const cx = (col + 0.5) * bStep + (row % 2 ? bStep * 0.5 : 0);
                const cy = (row + 0.5) * bStep;
                const grad = hCtx.createRadialGradient(cx, cy, 0, cx, cy, bStep * 0.42);
                grad.addColorStop(0, 'rgba(255,255,255,0.95)');
                grad.addColorStop(0.55, 'rgba(190,190,190,0.55)');
                grad.addColorStop(1, 'rgba(40,40,40,0.85)');
                hCtx.fillStyle = grad;
                hCtx.beginPath(); hCtx.arc(cx, cy, bStep * 0.42, 0, Math.PI * 2); hCtx.fill();
            }
        }
    } else if (type === 'tulle') {
        // 🕸 蓬蓬网纱：极细的斜向网眼
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 2;
        hCtx.strokeStyle = 'rgba(255,255,255,0.50)';
        for (let i = -res; i < res * 2; i += 16) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i, res); hCtx.lineTo(i + res, 0); hCtx.stroke();
        }
    } else if (type === 'vinyl') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = '#a0a0a0';
        hCtx.lineWidth = 1;
        for (let i = 0; i < res; i += 4) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(0, i); hCtx.lineTo(res, i); hCtx.stroke();
        }
        const imgData = hCtx.getImageData(0, 0, res, res);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const v = Math.random() * 40 - 20;
            imgData.data[i] += v; imgData.data[i+1] += v; imgData.data[i+2] += v;
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (type === 'flax') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for(let i=0; i<res*1.5; i++) {
            const isX = Math.random() > 0.5;
            const pos = Math.random() * res;
            const len = Math.random() * 40 + 10;
            const start = Math.random() * res;
            const v = Math.floor(Math.random() * 80 + 80);
            hCtx.strokeStyle = `rgba(${v},${v},${v},0.6)`;
            hCtx.lineWidth = Math.random() * 3 + 1;
            hCtx.beginPath();
            if (isX) {
                hCtx.moveTo(start, pos); hCtx.lineTo(start + len, pos);
            } else {
                hCtx.moveTo(pos, start); hCtx.lineTo(pos, start + len);
            }
            hCtx.stroke();
        }
    } else if (type === 'real_leather') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for(let i=0; i<3000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * 4 + 1;
            const v = Math.floor(Math.random() * 50 + 100);
            const grad = hCtx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(${v},${v},${v},0.8)`);
            grad.addColorStop(1, 'rgba(128,128,128,0)');
            hCtx.fillStyle = grad;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI*2); hCtx.fill();
        }
        hCtx.strokeStyle = 'rgba(50,50,50,0.3)';
        for(let i=0; i<100; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            hCtx.lineWidth = Math.random() * 2 + 0.5;
            hCtx.beginPath(); hCtx.moveTo(x, y);
            hCtx.lineTo(x + (Math.random()-0.5)*100, y + (Math.random()-0.5)*100);
            hCtx.stroke();
        }
    } else if (type === 'fluff') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for(let i=0; i<20000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const len = Math.random() * 10 + 2;
            const ang = Math.random() * Math.PI * 2;
            const v = Math.floor(Math.random() * 100 + 80);
            hCtx.strokeStyle = `rgba(${v},${v},${v},0.7)`;
            hCtx.lineWidth = Math.random() * 1.5 + 0.5;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            hCtx.quadraticCurveTo(x + Math.cos(ang)*len*0.5 + (Math.random()-0.5)*10, y + Math.sin(ang)*len*0.5 + (Math.random()-0.5)*10, x + Math.cos(ang)*len, y + Math.sin(ang)*len);
            hCtx.stroke();
        }
    } else if (type === 'square_weave') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const cols = 24;
        const size = res / cols;
        const imgData = hCtx.getImageData(0, 0, res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const cx = Math.floor(x / size);
                const cy = Math.floor(y / size);
                const isEven = ((cx + cy) % 2) === 0;
                const localX = (x % size) / size;
                const localY = (y % size) / size;
                let height = 0;
                if (isEven) {
                    height = Math.sin((localX + localY) * Math.PI); 
                } else {
                    height = Math.sin((localX + (1 - localY)) * Math.PI);
                }
                const v = Math.floor(height * 255);
                const idx = (y * res + x) * 4;
                imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
            }
        }
        hCtx.putImageData(imgData, 0, 0);
        hCtx.lineCap = 'round';
        for (let i = 0; i < cols; i++) {
            for (let j = 0; j < cols; j++) {
                const isEven = ((i + j) % 2) === 0;
                const cx = i * size + size / 2;
                const cy = j * size + size / 2;
                for(let k=0; k<6; k++) {
                    const offset = (Math.random() - 0.5) * size * 0.8;
                    const v = Math.floor(Math.random() * 100 + 80);
                    hCtx.strokeStyle = `rgba(${v},${v},${v},0.5)`;
                    hCtx.lineWidth = size * 0.05;
                    hCtx.beginPath();
                    if (isEven) {
                        hCtx.moveTo(cx - size/2 + offset, cy - size/2);
                        hCtx.lineTo(cx - size/2 + offset + size, cy + size/2);
                    } else {
                        hCtx.moveTo(cx - size/2, cy - size/2 + offset);
                        hCtx.lineTo(cx + size/2, cy - size/2 + offset + size);
                    }
                    hCtx.stroke();
                }
            }
        }
    } else if (type === 'gauze') {
        hCtx.fillStyle = '#404040';
        hCtx.fillRect(0, 0, res, res);
        const grid = 8;
        const stepG = res / grid;
        hCtx.strokeStyle = '#ffffff';
        hCtx.lineWidth = stepG * 0.4;
        hCtx.lineCap = 'round';
        for(let i=0; i<=grid; i++) {
            hCtx.beginPath();
            for(let j=0; j<=res; j+=10) {
                const offset = (Math.random() - 0.5) * stepG * 0.2;
                if(j===0) hCtx.moveTo(i*stepG + offset, j);
                else hCtx.lineTo(i*stepG + offset, j);
            }
            hCtx.stroke();
            hCtx.beginPath();
            for(let j=0; j<=res; j+=10) {
                const offset = (Math.random() - 0.5) * stepG * 0.2;
                if(j===0) hCtx.moveTo(j, i*stepG + offset);
                else hCtx.lineTo(j, i*stepG + offset);
            }
            hCtx.stroke();
        }
    } else if (type === 'felt') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for(let i=0; i<40000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const len = Math.random() * 3 + 1;
            const ang = Math.random() * Math.PI * 2;
            const v = Math.floor(Math.random() * 150 + 50);
            hCtx.strokeStyle = `rgba(${v},${v},${v},0.3)`;
            hCtx.lineWidth = Math.random() * 2 + 0.5;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            hCtx.lineTo(x + Math.cos(ang)*len, y + Math.sin(ang)*len);
            hCtx.stroke();
        }
    } else if (type === 'plastic_wrap') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';
        for(let i=0; i<100; i++) {
            hCtx.lineWidth = Math.random() * 6 + 2;
            let x = Math.random() * res;
            let y = Math.random() * res;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            const segs = Math.floor(Math.random() * 5) + 2;
            for(let j=0; j<segs; j++) {
                x += (Math.random() - 0.5) * res * 0.4;
                y += (Math.random() - 0.5) * res * 0.4;
                hCtx.lineTo(x, y);
            }
            const isHigh = Math.random() > 0.5;
            hCtx.strokeStyle = isHigh ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)';
            hCtx.stroke();
        }
    } else if (type === 'rice_paper') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for(let i=0; i<3000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const len = Math.random() * 80 + 20;
            const ang = Math.random() * Math.PI * 2;
            const v = Math.floor(Math.random() * 80 + 80);
            hCtx.strokeStyle = `rgba(${v},${v},${v},0.4)`;
            hCtx.lineWidth = Math.random() * 1.5 + 0.5;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            hCtx.quadraticCurveTo(
                x + Math.cos(ang)*len*0.5 + (Math.random()-0.5)*20, 
                y + Math.sin(ang)*len*0.5 + (Math.random()-0.5)*20, 
                x + Math.cos(ang)*len, 
                y + Math.sin(ang)*len
            );
            hCtx.stroke();
        }
    } else if (type === 'corduroy') {
        hCtx.fillStyle = '#404040';
        hCtx.fillRect(0, 0, res, res);
        const cols = 24;
        const w = res / cols;
        for(let i=0; i<cols; i++) {
            const cx = i * w;
            const grad = hCtx.createLinearGradient(cx, 0, cx + w, 0);
            grad.addColorStop(0, '#404040');
            grad.addColorStop(0.3, '#a0a0a0');
            grad.addColorStop(0.5, '#ffffff');
            grad.addColorStop(0.7, '#a0a0a0');
            grad.addColorStop(1, '#404040');
            hCtx.fillStyle = grad;
            hCtx.fillRect(cx, 0, w, res);
        }
        for(let i=0; i<5000; i++) {
            const x = Math.random()*res; const y = Math.random()*res;
            hCtx.fillStyle = `rgba(255,255,255,${Math.random()*0.2})`;
            hCtx.fillRect(x, y, 1, Math.random()*4);
        }
    } else if (type === 'cashmere') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for(let i=0; i<60000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * 2 + 1;
            const v = Math.floor(Math.random() * 40 + 100);
            hCtx.fillStyle = `rgba(${v},${v},${v},0.3)`;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI*2); hCtx.fill();
        }
    } else if (type === 'brushed') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for(let i=0; i<res; i++) {
            const v = Math.random() * 255;
            hCtx.fillStyle = `rgba(${v},${v},${v},0.2)`;
            hCtx.fillRect(0, i, res, 1);
        }
    } else if (type === 'noise') {
        const imgData = hCtx.createImageData(res, res);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const v = Math.random() * 80 + 88;
            imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (type === 'twill') {
        hCtx.lineWidth = step * 0.5; 
        hCtx.lineCap = "round";
        for(let i=-n*2; i<n*3; i++) {
            hCtx.beginPath();
            hCtx.strokeStyle = (i%2===0) ? "#ffffff" : "#000000";
            hCtx.moveTo(i*step, 0);
            hCtx.lineTo(i*step + res, res);
            hCtx.stroke();
        }
    } else if (type === 'knit') {
        // 针织毛衣：连续的 V 形织列（一行一条不间断的折线），绒面厚实
        const KC = 18;
        const kStep = res / KC;
        const rowGap = kStep * 0.62;
        hCtx.fillStyle = '#7e7e7e';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';

        const drawKnitRow = (baseY, shiftX, color, lw, dy) => {
            hCtx.strokeStyle = color;
            hCtx.lineWidth = lw;
            hCtx.beginPath();
            let x = -kStep * 2 + shiftX;
            let up = false;
            hCtx.moveTo(x, baseY + dy);
            while (x < res + kStep * 2) {
                x += kStep * 0.5;
                up = !up;
                hCtx.lineTo(x, baseY + dy + (up ? -kStep * 0.85 : 0));
            }
            hCtx.stroke();
        };

        const rows = Math.ceil(res / rowGap) + 4;
        for (let r = -3; r <= rows; r++) {
            const baseY = r * rowGap;
            const shiftX = (r % 2 === 0) ? 0 : kStep * 0.25;
            // 深沟
            drawKnitRow(baseY, shiftX, 'rgba(38,38,38,0.60)', kStep * 0.48, kStep * 0.10);
            // 主线圈
            drawKnitRow(baseY, shiftX, 'rgba(236,236,236,0.96)', kStep * 0.30, 0);
            // 高光
            drawKnitRow(baseY, shiftX, 'rgba(255,255,255,0.45)', kStep * 0.10, -kStep * 0.10);
        }
        // 绒面毛羽
        for (let i = 0; i < 6000; i++) {
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
            hCtx.fillRect(Math.random() * res, Math.random() * res, 1.2, 1.6);
        }
    } else if (type === 'carbon') {
        // 碳纤维：2×2 斜纹布 + 细丝高光
        const CF = 16;
        const cStep = res / CF;
        hCtx.fillStyle = '#4a4a4a';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < CF; i++) {
            for (let j = 0; j < CF; j++) {
                const dirUp = ((i + j) % 4) < 2;
                const x = i * cStep;
                const y = j * cStep;
                const grad = dirUp
                    ? hCtx.createLinearGradient(x, y, x + cStep, y + cStep)
                    : hCtx.createLinearGradient(x + cStep, y, x, y + cStep);
                grad.addColorStop(0, 'rgba(30,30,30,0.95)');
                grad.addColorStop(0.45, 'rgba(140,140,140,0.95)');
                grad.addColorStop(0.5, 'rgba(240,240,240,0.95)');
                grad.addColorStop(0.56, 'rgba(150,150,150,0.95)');
                grad.addColorStop(1, 'rgba(28,28,28,0.95)');
                hCtx.fillStyle = grad;
                hCtx.fillRect(x, y, cStep, cStep);
                // 编织细丝
                hCtx.strokeStyle = 'rgba(255,255,255,0.10)';
                hCtx.lineWidth = 1;
                for (let k = 1; k < 4; k++) {
                    hCtx.beginPath();
                    if (dirUp) {
                        hCtx.moveTo(x, y + cStep * k / 4);
                        hCtx.lineTo(x + cStep, y + cStep * k / 4);
                    } else {
                        hCtx.moveTo(x + cStep * k / 4, y);
                        hCtx.lineTo(x + cStep * k / 4, y + cStep);
                    }
                    hCtx.stroke();
                }
            }
        }
    } else if (type === 'leather') {
        const gridCount = 4; 
        const dStep = res / gridCount;
        hCtx.fillStyle = '#b0b0b0';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = '#333333';
        hCtx.lineWidth = 10; 
        hCtx.lineJoin = 'round';
        for(let i=-gridCount; i<gridCount*2; i++) {
            hCtx.beginPath(); hCtx.moveTo(i * dStep, 0); hCtx.lineTo(i * dStep + res, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i * dStep, 0); hCtx.lineTo(i * dStep - res, res); hCtx.stroke();
        }
        hCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        for(let i=0; i<5000; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * 2.5 + 0.5; 
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const px = x + ox * res;
                    const py = y + oy * res;
                    if (px + r > 0 && px - r < res && py + r > 0 && py - r < res) {
                        hCtx.beginPath();
                        hCtx.arc(px, py, r, 0, Math.PI*2);
                        hCtx.fill();
                    }
                }
            }
        }
    } else if (type === 'stone') {
        const imgData = hCtx.createImageData(res, res);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const v = Math.random() * 100 + 100;
            imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
        }
        hCtx.putImageData(imgData, 0, 0);
        for(let i=0; i<100; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * 30 + 10;
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const px = x + ox * res;
                    const py = y + oy * res;
                    if (px + r > 0 && px - r < res && py + r > 0 && py - r < res) {
                        const grad = hCtx.createRadialGradient(px, py, 0, px, py, r);
                        grad.addColorStop(0, "rgba(0,0,0,0.4)");
                        grad.addColorStop(1, "rgba(0,0,0,0)");
                        hCtx.fillStyle = grad;
                        hCtx.beginPath(); hCtx.arc(px, py, r, 0, Math.PI*2); hCtx.fill();
                    }
                }
            }
        }
    } else if (type === 'wrinkle') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 8;
        hCtx.lineCap = "round";
        for(let i=0; i<100; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const cp1x = x + Math.random()*100-50;
            const cp1y = y + Math.random()*100-50;
            const cp2x = x + Math.random()*100-50;
            const cp2y = y + Math.random()*100-50;
            const ex = x + Math.random()*100-50;
            const ey = y + Math.random()*100-50;
            const col = Math.random() > 0.5 ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const px = x + ox * res;
                    const py = y + oy * res;
                    if (px > -100 && px < res + 100 && py > -100 && py < res + 100) {
                        hCtx.strokeStyle = col;
                        hCtx.beginPath();
                        hCtx.moveTo(px, py);
                        hCtx.bezierCurveTo(px + (cp1x-x), py + (cp1y-y), px + (cp2x-x), py + (cp2y-y), px + (ex-x), py + (ey-y));
                        hCtx.stroke();
                    }
                }
            }
        }
    } else if (type === 'diamond') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = '#ffffff';
        hCtx.lineWidth = 6;
        hCtx.lineCap = "round";
        const dStep = res / 8;
        for(let i=-8; i<16; i++) {
            hCtx.beginPath(); hCtx.moveTo(i*dStep, 0); hCtx.lineTo(i*dStep + res, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i*dStep, 0); hCtx.lineTo(i*dStep - res, res); hCtx.stroke();
        }
    } else if (type === 'oxford') {
        // 牛津布：细密十字平纹 + 涂层微光
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = 'rgba(255,255,255,0.16)';
        hCtx.lineWidth = 1;
        for (let i = 0; i < res; i += 4) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(0, i); hCtx.lineTo(res, i); hCtx.stroke();
        }
        hCtx.fillStyle = 'rgba(0,0,0,0.10)';
        for (let i = 0; i < 420; i++) {
            hCtx.fillRect(Math.random() * res, Math.random() * res, 2, 2);
        }
    } else if (type === 'duck_canvas') {
        // 防水帆布：粗斜向交织 + 涂层压痕
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 3;
        hCtx.strokeStyle = 'rgba(255,255,255,0.22)';
        for (let i = -res; i < res * 2; i += 14) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i, res); hCtx.lineTo(i + res, 0); hCtx.stroke();
        }
        hCtx.strokeStyle = 'rgba(30,30,30,0.20)';
        hCtx.lineWidth = 1;
        for (let i = -res; i < res * 2; i += 14) {
            hCtx.beginPath(); hCtx.moveTo(i + 2, 0); hCtx.lineTo(i + res + 2, res); hCtx.stroke();
        }
    } else if (type === 'sateen') {
        // 贡缎：单向细斜纹，缎面平滑
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = 'rgba(255,255,255,0.13)';
        hCtx.lineWidth = 2;
        for (let i = -res; i < res * 2; i += 5) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res); hCtx.stroke();
        }
        hCtx.fillStyle = 'rgba(0,0,0,0.06)';
        for (let i = 0; i < 500; i++) hCtx.fillRect(Math.random() * res, Math.random() * res, 1.5, 1.5);
    } else if (type === 'jersey') {
        // 平针线圈：更小更密的连续 V 列，表面平整带纵向轻罗纹
        const JC = 34;
        const jStep = res / JC;
        const rowGap = jStep * 0.70;
        hCtx.fillStyle = '#838383';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';

        const drawJerseyRow = (baseY, shiftX, color, lw, dy) => {
            hCtx.strokeStyle = color;
            hCtx.lineWidth = lw;
            hCtx.beginPath();
            let x = -jStep * 2 + shiftX;
            let up = false;
            hCtx.moveTo(x, baseY + dy);
            while (x < res + jStep * 2) {
                x += jStep * 0.5;
                up = !up;
                hCtx.lineTo(x, baseY + dy + (up ? -jStep * 0.80 : 0));
            }
            hCtx.stroke();
        };

        const rows = Math.ceil(res / rowGap) + 4;
        for (let r = -3; r <= rows; r++) {
            const baseY = r * rowGap;
            const shiftX = (r % 2 === 0) ? 0 : jStep * 0.25;
            drawJerseyRow(baseY, shiftX, 'rgba(58,58,58,0.42)', jStep * 0.34, jStep * 0.08);
            drawJerseyRow(baseY, shiftX, 'rgba(242,242,242,0.94)', jStep * 0.22, 0);
        }
        // 纵向轻罗纹
        for (let x = 0; x < res; x += jStep) {
            hCtx.fillStyle = 'rgba(255,255,255,0.05)';
            hCtx.fillRect(x, 0, 1, res);
            hCtx.fillStyle = 'rgba(0,0,0,0.05)';
            hCtx.fillRect(x + jStep * 0.5, 0, 1, res);
        }
        for (let i = 0; i < 4200; i++) {
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
            hCtx.fillRect(Math.random() * res, Math.random() * res, 1, 1.4);
        }
    } else if (type === 'rib_knit') {
        // 罗纹针织：竖向凸条
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const ribW = 14;
        for (let x = 0; x < res; x += ribW) {
            const grad = hCtx.createLinearGradient(x, 0, x + ribW, 0);
            grad.addColorStop(0, 'rgba(60,60,60,0.55)');
            grad.addColorStop(0.45, 'rgba(220,220,220,0.75)');
            grad.addColorStop(1, 'rgba(60,60,60,0.55)');
            hCtx.fillStyle = grad;
            hCtx.fillRect(x, 0, ribW, res);
        }
        hCtx.strokeStyle = 'rgba(0,0,0,0.08)';
        hCtx.lineWidth = 1;
        for (let y = 0; y < res; y += 6) {
            hCtx.beginPath(); hCtx.moveTo(0, y); hCtx.lineTo(res, y); hCtx.stroke();
        }
    } else if (type === 'plisse') {
        // 百褶：规则竖向折痕，明暗相间
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const pW = 16;
        for (let x = 0; x < res; x += pW * 2) {
            const g1 = hCtx.createLinearGradient(x, 0, x + pW, 0);
            g1.addColorStop(0, 'rgba(240,240,240,0.85)');
            g1.addColorStop(1, 'rgba(120,120,120,0.25)');
            hCtx.fillStyle = g1;
            hCtx.fillRect(x, 0, pW, res);
            const g2 = hCtx.createLinearGradient(x + pW, 0, x + pW * 2, 0);
            g2.addColorStop(0, 'rgba(110,110,110,0.25)');
            g2.addColorStop(1, 'rgba(240,240,240,0.85)');
            hCtx.fillStyle = g2;
            hCtx.fillRect(x + pW, 0, pW, res);
        }
    } else if (type === 'tweed') {
        // 粗花呢：粗颗粒 + 斜向纱线
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 5000; i++) {
            const v = Math.random();
            hCtx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)';
            const s = Math.random() * 3 + 1;
            hCtx.fillRect(Math.random() * res, Math.random() * res, s, s);
        }
        hCtx.lineWidth = 2;
        for (const dir of [1, -1]) {
            hCtx.strokeStyle = dir > 0 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
            for (let i = -res; i < res * 2; i += 22) {
                hCtx.beginPath();
                hCtx.moveTo(i, dir > 0 ? 0 : res);
                hCtx.lineTo(i + res, dir > 0 ? res : 0);
                hCtx.stroke();
            }
        }
    } else if (type === 'bamboo') {
        // 竹席：竖向竹条 + 横节
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const bW = 18;
        for (let x = 0; x < res; x += bW) {
            const grad = hCtx.createLinearGradient(x, 0, x + bW, 0);
            grad.addColorStop(0, 'rgba(50,50,50,0.55)');
            grad.addColorStop(0.5, 'rgba(210,210,210,0.70)');
            grad.addColorStop(1, 'rgba(50,50,50,0.55)');
            hCtx.fillStyle = grad;
            hCtx.fillRect(x, 0, bW, res);
        }
        hCtx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let y = 0; y < res; y += 64) hCtx.fillRect(0, y, res, 3);
        hCtx.strokeStyle = 'rgba(0,0,0,0.10)';
        hCtx.lineWidth = 1;
        for (let i = 0; i < 400; i++) {
            hCtx.beginPath();
            const x = Math.random() * res, y = Math.random() * res;
            hCtx.moveTo(x, y); hCtx.lineTo(x, y + Math.random() * 12 + 4);
            hCtx.stroke();
        }
    } else if (type === 'aluminium') {
        // 锡箔：细碎褶皱
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for (let i = 0; i < 900; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const len = Math.random() * 26 + 6;
            const ang = Math.random() * Math.PI * 2;
            hCtx.lineWidth = Math.random() * 1.6 + 0.4;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.35)';
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            hCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
            hCtx.stroke();
        }
    } else if (type === 'cork') {
        // 软木：密集小颗粒
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 6000; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const r = Math.random() * 2.6 + 0.6;
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)';
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI * 2); hCtx.fill();
        }
    } else if (type === 'devore') {
        // 烧花绒：不规则渐隐斑块
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 90; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const r = Math.random() * res * 0.16 + 12;
            const grad = hCtx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, Math.random() > 0.5 ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)');
            grad.addColorStop(1, 'rgba(128,128,128,0)');
            hCtx.fillStyle = grad;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI * 2); hCtx.fill();
        }
        hCtx.strokeStyle = 'rgba(255,255,255,0.10)';
        hCtx.lineWidth = 1;
        for (let i = 0; i < res; i += 3) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
        }
    } else if (type === 'perforated') {
        // 打孔：规则圆孔（高度凹下去）
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const pHoleStep = res / 12;
        for (let row = 0; row < 13; row++) {
            for (let col = 0; col < 13; col++) {
                const cx = col * pHoleStep + (row % 2 ? pHoleStep * 0.5 : 0);
                const cy = row * pHoleStep;
                const r = pHoleStep * 0.26;
                const grad = hCtx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6);
                grad.addColorStop(0, 'rgba(0,0,0,0.95)');
                grad.addColorStop(0.7, 'rgba(20,20,20,0.75)');
                grad.addColorStop(1, 'rgba(128,128,128,0)');
                hCtx.fillStyle = grad;
                hCtx.beginPath(); hCtx.arc(cx, cy, r * 1.6, 0, Math.PI * 2); hCtx.fill();
            }
        }
    } else if (type === 'banner_mesh') {
        // 喷绘粗织：更粗的经纬线（户外广告布）
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 3;
        for (const [col, stepW] of [['rgba(255,255,255,0.28)', 10], ['rgba(0,0,0,0.18)', 10]]) {
            hCtx.strokeStyle = col;
            for (let i = 0; i < res; i += stepW) {
                hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
                hCtx.beginPath(); hCtx.moveTo(0, i); hCtx.lineTo(res, i); hCtx.stroke();
            }
        }
        for (let i = 0; i < 3000; i++) {
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.26)';
            hCtx.fillRect(Math.random() * res, Math.random() * res, 2, 2);
        }
    } else if (type === 'silk_habotai') {
        // 电力纺：极细密平纹
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 1;
        hCtx.strokeStyle = 'rgba(255,255,255,0.09)';
        for (let i = 0; i < res; i += 3) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
            hCtx.strokeStyle = 'rgba(0,0,0,0.06)';
            hCtx.beginPath(); hCtx.moveTo(0, i); hCtx.lineTo(res, i); hCtx.stroke();
            hCtx.strokeStyle = 'rgba(255,255,255,0.09)';
        }
        for (let i = 0; i < 800; i++) {
            hCtx.fillStyle = 'rgba(255,255,255,0.06)';
            hCtx.fillRect(Math.random() * res, Math.random() * res, 2, 2);
        }
    } else if (type === 'fishnet') {
        // 渔网：粗斜向网格 + 网结
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 5;
        hCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        for (let i = -res; i < res * 2; i += 26) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i, res); hCtx.lineTo(i + res, 0); hCtx.stroke();
        }
        hCtx.strokeStyle = 'rgba(0,0,0,0.45)';
        hCtx.lineWidth = 2;
        for (let i = -res; i < res * 2; i += 26) {
            hCtx.beginPath(); hCtx.moveTo(i + 3, 0); hCtx.lineTo(i + res + 3, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i - 3, res); hCtx.lineTo(i + res - 3, 0); hCtx.stroke();
        }
    } else if (type === 'tie_dye') {
        // 扎染：大尺度柔和晕染
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 26; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const r = Math.random() * res * 0.22 + 20;
            const grad = hCtx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, Math.random() > 0.45 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)');
            grad.addColorStop(1, 'rgba(128,128,128,0)');
            hCtx.fillStyle = grad;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI * 2); hCtx.fill();
        }
    } else if (type === 'suede') {
        // 麂皮：细密短绒
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 18000; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const a = Math.random() * Math.PI * 2, len = Math.random() * 3 + 1;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
            hCtx.lineWidth = 1;
            hCtx.beginPath(); hCtx.moveTo(x, y); hCtx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); hCtx.stroke();
        }
    } else if (type === 'mesh_fine') {
        // 细网眼
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = 'rgba(255,255,255,0.40)';
        hCtx.lineWidth = 1.6;
        for (let i = -res; i < res * 2; i += 9) {
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i + res, res); hCtx.stroke();
            hCtx.beginPath(); hCtx.moveTo(i, res); hCtx.lineTo(i + res, 0); hCtx.stroke();
        }
    } else if (type === 'cable_knit') {
        // 绞花针织：粗麻花辫
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const cableW = res / 4;
        for (let c = 0; c < 4; c++) {
            const baseX = cableW * (c + 0.5);
            hCtx.strokeStyle = 'rgba(255,255,255,0.50)';
            hCtx.lineWidth = 11;
            for (let y = -40; y < res + 40; y += 9) {
                const sway = Math.sin((y / res) * Math.PI * 4) * 22;
                hCtx.beginPath();
                hCtx.moveTo(baseX + sway, y);
                hCtx.lineTo(baseX + Math.sin(((y + 9) / res) * Math.PI * 4) * 22, y + 9);
                hCtx.stroke();
            }
        }
    } else if (type === 'hook') {
        // 钩编：小环
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = 'rgba(255,255,255,0.42)';
        hCtx.lineWidth = 3;
        const hStep = 16;
        for (let row = 0; row < res / hStep + 1; row++) {
            for (let col = 0; col < res / hStep + 1; col++) {
                const cx = col * hStep, cy = row * hStep + (col % 2 ? hStep * 0.5 : 0);
                hCtx.beginPath(); hCtx.arc(cx, cy, hStep * 0.34, Math.PI * 0.9, Math.PI * 2.15); hCtx.stroke();
            }
        }
    } else if (type === 'glitter') {
        // 闪粉：亮点
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 12000; i++) {
            hCtx.fillStyle = Math.random() > 0.45 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.50)';
            const s = Math.random() * 2.2 + 0.6;
            hCtx.beginPath(); hCtx.arc(Math.random() * res, Math.random() * res, s, 0, Math.PI * 2); hCtx.fill();
        }
    } else if (type === 'fleece') {
        // 抓绒：绒团
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 900; i++) {
            const x = Math.random() * res, y = Math.random() * res, r = Math.random() * 7 + 2;
            const grad = hCtx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, Math.random() > 0.5 ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)');
            grad.addColorStop(1, 'rgba(128,128,128,0)');
            hCtx.fillStyle = grad;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI * 2); hCtx.fill();
        }
    } else if (type === 'habotai') {
        // 电力纺：极细平纹
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineWidth = 1;
        for (let i = 0; i < res; i += 3) {
            hCtx.strokeStyle = 'rgba(255,255,255,0.09)';
            hCtx.beginPath(); hCtx.moveTo(i, 0); hCtx.lineTo(i, res); hCtx.stroke();
            hCtx.strokeStyle = 'rgba(0,0,0,0.06)';
            hCtx.beginPath(); hCtx.moveTo(0, i); hCtx.lineTo(res, i); hCtx.stroke();
        }
    } else if (type === 'brushed_metal') {
        // 拉丝金属：单向长丝
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 3000; i++) {
            const y = Math.random() * res, x = Math.random() * res;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.26)';
            hCtx.lineWidth = 1;
            hCtx.beginPath(); hCtx.moveTo(x, y); hCtx.lineTo(x + 120, y + (Math.random() - 0.5) * 2); hCtx.stroke();
        }
    }

    const hData = hCtx.getImageData(0, 0, res, res).data;
    const nData = ctx.createImageData(res, res);
    const strength = 3.0;
    for(let y=0; y<res; y++) {
        for(let x=0; x<res; x++) {
            const idx = (y * res + x) * 4;
            const leftX = (x - 1 + res) % res;
            const rightX = (x + 1) % res;
            const upY = (y - 1 + res) % res;
            const downY = (y + 1) % res;
            const hL = hData[(y * res + leftX) * 4] / 255;
            const hR = hData[(y * res + rightX) * 4] / 255;
            const hU = hData[(upY * res + x) * 4] / 255;
            const hD = hData[(downY * res + x) * 4] / 255;
            const dx = (hR - hL) * strength;
            const dy = (hD - hU) * strength;
            const len = Math.sqrt(dx*dx + dy*dy + 1.0);
            const nx = dx / len;
            const ny = dy / len;
            const nz = 1.0 / len;
            nData.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            nData.data[idx+1] = Math.floor((ny * 0.5 + 0.5) * 255);
            nData.data[idx+2] = Math.floor((nz * 0.5 + 0.5) * 255);
            nData.data[idx+3] = 255;
        }
    }
    ctx.putImageData(nData, 0, 0);

    const normalTex = new THREE.CanvasTexture(canvas);
    normalTex.wrapS = THREE.RepeatWrapping;
    normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if ('colorSpace' in normalTex) normalTex.colorSpace = THREE.LinearSRGBColorSpace;

    let alphaTex = null;
    if (type === 'mesh' || type === 'mesh_solid' || type === 'hex' || type === 'hex_solid') {
        const aCanvas = document.createElement('canvas');
        aCanvas.width = res; aCanvas.height = res;
        const aCtx = aCanvas.getContext('2d');
        aCtx.fillStyle = '#000000';
        aCtx.fillRect(0, 0, res, res);
        aCtx.strokeStyle = '#ffffff';
        aCtx.lineCap = 'round';
        aCtx.lineJoin = 'round';

        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = '#ffffff';
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';

        if (type === 'mesh' || type === 'mesh_solid') {
            const gridCount = 6; 
            const cellSize = res / gridCount;
            const radius = cellSize * 0.25;
            const half = cellSize / 2;
            aCtx.lineWidth = step * 0.3; 
            hCtx.lineWidth = step * 0.3; 
            const drawRoundRect = (ctx, cx, cy, half, r) => {
                ctx.beginPath();
                ctx.moveTo(cx - half + r, cy - half);
                ctx.lineTo(cx + half - r, cy - half);
                ctx.quadraticCurveTo(cx + half, cy - half, cx + half, cy - half + r);
                ctx.lineTo(cx + half, cy + half - r);
                ctx.quadraticCurveTo(cx + half, cy + half, cx + half - r, cy + half);
                ctx.lineTo(cx - half + r, cy + half);
                ctx.quadraticCurveTo(cx - half, cy + half, cx - half, cy + half - r);
                ctx.lineTo(cx - half, cy - half + r);
                ctx.quadraticCurveTo(cx - half, cy - half, cx - half + r, cy - half);
                ctx.closePath();
                ctx.stroke();
            };
            for(let i=-1; i<=gridCount; i++) {
                for(let j=-1; j<=gridCount; j++) {
                    const cx = i * cellSize + cellSize / 2;
                    const cy = j * cellSize + cellSize / 2;
                    drawRoundRect(aCtx, cx, cy, half, radius);
                    drawRoundRect(hCtx, cx, cy, half, radius);
                }
            }
        } else if (type === 'hex' || type === 'hex_solid') {
            const cols = 14; 
            const w = res / cols;
            const r = w / Math.sqrt(3);
            const h = 1.5 * r;
            const stretchY = (res / 8) / (2 * h); 
            aCtx.save();
            hCtx.save();
            aCtx.scale(1, stretchY);
            hCtx.scale(1, stretchY);
            aCtx.lineWidth = w * 0.35 / stretchY;
            hCtx.lineWidth = w * 0.35 / stretchY;
            for (let row = -1; row <= 20; row++) {
                for (let col = -1; col <= cols; col++) {
                    const cx = col * w + (row % 2 === 0 ? 0 : w / 2);
                    const cy = row * h;
                    aCtx.beginPath();
                    hCtx.beginPath();
                    for (let k = 0; k < 6; k++) {
                        const angle = Math.PI / 180 * (60 * k - 30);
                        const px = cx + r * Math.cos(angle);
                        const py = cy + r * Math.sin(angle);
                        if (k === 0) {
                            aCtx.moveTo(px, py); hCtx.moveTo(px, py);
                        } else {
                            aCtx.lineTo(px, py); hCtx.lineTo(px, py);
                        }
                    }
                    aCtx.closePath(); aCtx.stroke();
                    hCtx.closePath(); hCtx.stroke();
                }
            }
            aCtx.restore();
            hCtx.restore();
        }

        const hData2 = hCtx.getImageData(0, 0, res, res).data;
        const nData2 = ctx.createImageData(res, res);
        for(let y=0; y<res; y++) {
            for(let x=0; x<res; x++) {
                const idx = (y * res + x) * 4;
                const leftX = (x - 1 + res) % res;
                const rightX = (x + 1) % res;
                const upY = (y - 1 + res) % res;
                const downY = (y + 1) % res;
                const hL = hData2[(y * res + leftX) * 4] / 255;
                const hR = hData2[(y * res + rightX) * 4] / 255;
                const hU = hData2[(upY * res + x) * 4] / 255;
                const hD = hData2[(downY * res + x) * 4] / 255;
                const dx = (hR - hL) * strength;
                const dy = (hD - hU) * strength;
                const len = Math.sqrt(dx*dx + dy*dy + 1.0);
                const nx = dx / len;
                const ny = dy / len;
                const nz = 1.0 / len;
                nData2.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
                nData2.data[idx+1] = Math.floor((ny * 0.5 + 0.5) * 255);
                nData2.data[idx+2] = Math.floor((nz * 0.5 + 0.5) * 255);
                nData2.data[idx+3] = 255;
            }
        }
        ctx.putImageData(nData2, 0, 0);
        normalTex.needsUpdate = true;

        if (type !== 'mesh_solid' && type !== 'hex_solid') {
            alphaTex = new THREE.CanvasTexture(aCanvas);
            alphaTex.wrapS = THREE.RepeatWrapping;
            alphaTex.wrapT = THREE.RepeatWrapping;
            alphaTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        }
    }

    return { normalTex, alphaTex };
}

function createNoiseNormalMap(style) {
    const res = 512;
    const canvas = document.createElement('canvas');
    canvas.width = res; canvas.height = res;
    const hCtx = canvas.getContext('2d');

    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, res, res);

    if (style === 'sand') {
        const imgData = hCtx.createImageData(res, res);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const v = Math.random() * 255;
            imgData.data[i] = v; imgData.data[i+1] = v; imgData.data[i+2] = v; imgData.data[i+3] = 255;
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (style === 'fiber') {
        hCtx.lineWidth = 1;
        for(let i=0; i<res*4; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const len = Math.random() * 20 + 5;
            const ang = (Math.random() - 0.5) * 0.2;
            const dx = Math.cos(ang)*len;
            const dy = Math.sin(ang)*len;
            const col = `rgba(255,255,255,${Math.random()*0.5})`;
            for(let ox=-1; ox<=1; ox++) {
                for(let oy=-1; oy<=1; oy++) {
                    const px = x + ox * res;
                    const py = y + oy * res;
                    if (px+dx > 0 && px < res && py+dy > 0 && py < res) {
                        hCtx.strokeStyle = col;
                        hCtx.beginPath();
                        hCtx.moveTo(px, py);
                        hCtx.lineTo(px + dx, py + dy);
                        hCtx.stroke();
                    }
                }
            }
        }
    } else if (style === 'cloud') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for(let i=0; i<60; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * (res/5) + (res/10);
            const isHigh = Math.random() > 0.5;
            for(let ox=-1; ox<=1; ox++) {
                for(let oy=-1; oy<=1; oy++) {
                    const px = x + ox * res;
                    const py = y + oy * res;
                    if (px + r > 0 && px - r < res && py + r > 0 && py - r < res) {
                        const grad = hCtx.createRadialGradient(px, py, 0, px, py, r);
                        if (isHigh) {
                            grad.addColorStop(0, "rgba(255,255,255,1.0)");
                            grad.addColorStop(0.5, "rgba(255,255,255,0.5)");
                        } else {
                            grad.addColorStop(0, "rgba(0,0,0,0.8)");
                            grad.addColorStop(0.5, "rgba(0,0,0,0.4)");
                        }
                        grad.addColorStop(1, "rgba(128,128,128,0)");
                        hCtx.fillStyle = grad;
                        hCtx.beginPath(); hCtx.arc(px, py, r, 0, Math.PI*2); hCtx.fill();
                    }
                }
            }
        }
    } else if (style === 'crack') {
        hCtx.fillStyle = '#ffffff';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = '#000000';
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';
        for(let i=0; i<40; i++) {
            hCtx.lineWidth = Math.random() * 2 + 0.5;
            let x = Math.random() * res;
            let y = Math.random() * res;
            const segments = [];
            segments.push({x, y});
            const segCount = Math.floor(Math.random() * 5) + 3;
            for(let j=0; j<segCount; j++) {
                x += (Math.random() - 0.5) * res * 0.3;
                y += (Math.random() - 0.5) * res * 0.3;
                segments.push({x, y});
            }
            for(let ox=-1; ox<=1; ox++) {
                for(let oy=-1; oy<=1; oy++) {
                    hCtx.beginPath();
                    hCtx.moveTo(segments[0].x + ox*res, segments[0].y + oy*res);
                    for(let j=1; j<segments.length; j++) {
                        hCtx.lineTo(segments[j].x + ox*res, segments[j].y + oy*res);
                    }
                    hCtx.stroke();
                }
            }
        }
    } else if (style === 'ripple') {
        const imgData = hCtx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const idx = (y * res + x) * 4;
                const dist = Math.sqrt((x - res/2)**2 + (y - res/2)**2);
                const v = (Math.sin(dist * 0.2) * 0.5 + 0.5) * 255;
                imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
            }
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (style === 'cellular') {
        const numCells = 80;
        const points = [];
        for(let i=0; i<numCells; i++) {
            points.push({x: Math.random()*res, y: Math.random()*res});
        }
        const imgData = hCtx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const idx = (y * res + x) * 4;
                let minDist = res;
                for(const p of points) {
                    for(let ox=-1; ox<=1; ox++) {
                        for(let oy=-1; oy<=1; oy++) {
                            const dx = x - (p.x + ox*res);
                            const dy = y - (p.y + oy*res);
                            const d = Math.hypot(dx, dy);
                            if (d < minDist) minDist = d;
                        }
                    }
                }
                const v = Math.max(0, 255 - minDist * 6); 
                imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
            }
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (style === 'wood') {
        const imgData = hCtx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const idx = (y * res + x) * 4;
                const noise = Math.sin(x * 0.1) * 2 + Math.sin(y * 0.1) * 2;
                const v = (Math.sin((x + noise) * 0.15) * 0.5 + 0.5) * 255;
                imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
            }
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (style === 'marble') {
        const imgData = hCtx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const idx = (y * res + x) * 4;
                const turbulence = Math.sin(x * 0.05) * 50 + Math.sin(y * 0.05) * 50;
                const v = (Math.sin((x + y + turbulence) * 0.1) * 0.5 + 0.5) * 255;
                imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
            }
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (style === 'rusty') {
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for(let i=0; i<200; i++) {
            const x = Math.random() * res;
            const y = Math.random() * res;
            const r = Math.random() * 20 + 5;
            const isDark = Math.random() > 0.5;
            for(let ox=-1; ox<=1; ox++) {
                for(let oy=-1; oy<=1; oy++) {
                    const px = x + ox * res;
                    const py = y + oy * res;
                    if (px + r > 0 && px - r < res && py + r > 0 && py - r < res) {
                        const grad = hCtx.createRadialGradient(px, py, 0, px, py, r);
                        grad.addColorStop(0, isDark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.6)");
                        grad.addColorStop(1, "rgba(128,128,128,0)");
                        hCtx.fillStyle = grad;
                        hCtx.beginPath(); hCtx.arc(px, py, r, 0, Math.PI*2); hCtx.fill();
                    }
                }
            }
        }
    } else if (style === 'weaveNode') {
        const imgData = hCtx.createImageData(res, res);
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const idx = (y * res + x) * 4;
                const v = (Math.sin(x * 0.2) * Math.sin(y * 0.2) * 0.5 + 0.5) * 255;
                imgData.data[idx] = v; imgData.data[idx+1] = v; imgData.data[idx+2] = v; imgData.data[idx+3] = 255;
            }
        }
        hCtx.putImageData(imgData, 0, 0);
    } else if (style === 'quilted') {
        hCtx.fillStyle = '#000000';
        hCtx.fillRect(0, 0, res, res);
        const gridCount = 4; 
        const cellSize = res / gridCount;
        for (let y = -1; y <= gridCount; y++) {
            for (let x = -1; x <= gridCount; x++) {
                const cx = x * cellSize + cellSize / 2;
                const cy = y * cellSize + cellSize / 2;
                hCtx.fillStyle = '#555555';
                const roundRect = (c, x, y, w, h, r) => {
                    c.beginPath();
                    c.moveTo(x + r, y);
                    c.lineTo(x + w - r, y);
                    c.quadraticCurveTo(x + w, y, x + w, y + r);
                    c.lineTo(x + w, y + h - r);
                    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                    c.lineTo(x + r, y + h);
                    c.quadraticCurveTo(x, y + h, x, y + h - r);
                    c.lineTo(x, y + r);
                    c.quadraticCurveTo(x, y, x + r, y);
                    c.closePath();
                };
                roundRect(hCtx, x * cellSize + cellSize*0.05, y * cellSize + cellSize*0.05, cellSize*0.9, cellSize*0.9, cellSize*0.25);
                hCtx.fill();
                const grad = hCtx.createRadialGradient(cx, cy, 0, cx, cy, cellSize * 0.45);
                grad.addColorStop(0, "#ffffff");
                grad.addColorStop(1, "rgba(255,255,255,0)");
                hCtx.fillStyle = grad;
                hCtx.beginPath();
                hCtx.arc(cx, cy, cellSize * 0.45, 0, Math.PI * 2);
                hCtx.fill();
            }
        }
    } else if (style === 'velvet_pile') {
        // 绒面短绒：极细密短毛，方向随机
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        for (let i = 0; i < 24000; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const len = Math.random() * 4 + 1;
            const ang = Math.random() * Math.PI * 2;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)';
            hCtx.lineWidth = 1;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            hCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
            hCtx.stroke();
        }
    } else if (style === 'corduroy' || style === 'corduroy_soft') {
        // 灯芯绒：竖向绒条（软版把明暗压低）
        const soft = style === 'corduroy_soft';
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const cStep = soft ? 26 : 20;
        for (let x = 0; x < res; x += cStep) {
            const grad = hCtx.createLinearGradient(x, 0, x + cStep, 0);
            if (soft) {
                grad.addColorStop(0, 'rgba(150,150,150,0.9)');
                grad.addColorStop(0.5, 'rgba(205,205,205,1)');
                grad.addColorStop(1, 'rgba(150,150,150,0.9)');
            } else {
                grad.addColorStop(0, 'rgba(45,45,45,0.95)');
                grad.addColorStop(0.5, 'rgba(225,225,225,1)');
                grad.addColorStop(1, 'rgba(45,45,45,0.95)');
            }
            hCtx.fillStyle = grad;
            hCtx.fillRect(x, 0, cStep * 0.75, res);
        }
        hCtx.strokeStyle = 'rgba(0,0,0,0.10)';
        hCtx.lineWidth = 1;
        for (let y = 0; y < res; y += 9) {
            hCtx.beginPath(); hCtx.moveTo(0, y); hCtx.lineTo(res, y); hCtx.stroke();
        }
    } else if (style === 'mesh_fine') {
        // 细网眼：密集的正交小孔，孔洞为凹陷（暗），网线为凸起（亮）
        const MF = 26;
        const mfStep = res / MF;
        hCtx.fillStyle = '#8c8c8c';
        hCtx.fillRect(0, 0, res, res);
        for (let row = 0; row < MF; row++) {
            for (let col = 0; col < MF; col++) {
                const cx = (col + 0.5) * mfStep;
                const cy = (row + 0.5) * mfStep;
                // 孔（凹）
                const hole = hCtx.createRadialGradient(cx, cy, 0, cx, cy, mfStep * 0.42);
                hole.addColorStop(0, 'rgba(10,10,10,0.95)');
                hole.addColorStop(0.62, 'rgba(40,40,40,0.85)');
                hole.addColorStop(1, 'rgba(150,150,150,0.25)');
                hCtx.fillStyle = hole;
                hCtx.beginPath(); hCtx.arc(cx, cy, mfStep * 0.42, 0, Math.PI * 2); hCtx.fill();
            }
        }
        // 网线（凸）
        hCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        hCtx.lineWidth = mfStep * 0.30;
        hCtx.lineCap = 'round';
        for (let row = 0; row < MF; row++) {
            const y = row * mfStep;
            for (let col = 0; col < MF; col++) {
                const x = col * mfStep;
                if ((row + col) % 2 === 0) {
                    hCtx.beginPath(); hCtx.moveTo(x, y); hCtx.lineTo(x + mfStep * 0.5, y); hCtx.stroke();
                    hCtx.beginPath(); hCtx.moveTo(x + mfStep * 0.5, y); hCtx.lineTo(x + mfStep * 0.5, y + mfStep * 0.5); hCtx.stroke();
                } else {
                    hCtx.beginPath(); hCtx.moveTo(x, y + mfStep * 0.5); hCtx.lineTo(x + mfStep * 0.5, y + mfStep * 0.5); hCtx.stroke();
                    hCtx.beginPath(); hCtx.moveTo(x + mfStep * 0.5, y + mfStep * 0.5); hCtx.lineTo(x + mfStep, y + mfStep * 0.5); hCtx.stroke();
                }
            }
        }
    } else if (style === 'hook') {
        // 钩编：小钩针纹（开口环）
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        hCtx.strokeStyle = 'rgba(255,255,255,0.42)';
        hCtx.lineWidth = 3;
        const hStep = 16;
        for (let row = 0; row < res / hStep + 1; row++) {
            for (let col = 0; col < res / hStep + 1; col++) {
                const cx = col * hStep;
                const cy = row * hStep + (col % 2 ? hStep * 0.5 : 0);
                hCtx.beginPath();
                hCtx.arc(cx, cy, hStep * 0.34, Math.PI * 0.9, Math.PI * 2.15);
                hCtx.stroke();
            }
        }
    } else if (style === 'cable_knit') {
        // 绞花针织：竖向麻花辫（A/B 两股交叉），每行错位一次
        const CK = 5;
        const ckW = res / CK;
        hCtx.fillStyle = '#7e7e7e';
        hCtx.fillRect(0, 0, res, res);
        hCtx.lineCap = 'round';
        hCtx.lineJoin = 'round';
        for (let c = 0; c < CK; c++) {
            const cx = ckW * (c + 0.5);
            const amp = ckW * 0.26;
            const period = res / 3.2;
            for (const [phase, lw, tone] of [[0, ckW * 0.30, 'rgba(200,200,200,0.95)'], [Math.PI, ckW * 0.30, 'rgba(255,255,255,0.95)']]) {
                hCtx.strokeStyle = tone;
                hCtx.lineWidth = lw;
                hCtx.beginPath();
                for (let y = -ckW; y <= res + ckW; y += 2) {
                    const x = cx + Math.sin((y / period) * Math.PI * 2 + phase) * amp;
                    if (y === -ckW) hCtx.moveTo(x, y); else hCtx.lineTo(x, y);
                }
                hCtx.stroke();
            }
            // 中间的阴影沟
            hCtx.strokeStyle = 'rgba(35,35,35,0.5)';
            hCtx.lineWidth = ckW * 0.14;
            hCtx.beginPath();
            for (let y = -ckW; y <= res + ckW; y += 2) {
                const x = cx + Math.sin((y / period) * Math.PI * 2 + Math.PI / 2) * amp * 0.5;
                if (y === -ckW) hCtx.moveTo(x, y); else hCtx.lineTo(x, y);
            }
            hCtx.stroke();
        }
    } else if (style === 'snake') {
        // 蛇纹：大块鳞片
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const sStep = res / 14;
        for (let row = -1; row < 15; row++) {
            for (let col = -1; col < 15; col++) {
                const cx = col * sStep + (row % 2 ? sStep * 0.5 : 0);
                const cy = row * sStep;
                const grad = hCtx.createRadialGradient(cx - sStep * 0.15, cy - sStep * 0.2, 0, cx, cy, sStep * 0.7);
                grad.addColorStop(0, 'rgba(255,255,255,0.75)');
                grad.addColorStop(0.6, 'rgba(160,160,160,0.35)');
                grad.addColorStop(1, 'rgba(20,20,20,0.60)');
                hCtx.fillStyle = grad;
                hCtx.beginPath();
                hCtx.ellipse(cx, cy, sStep * 0.62, sStep * 0.5, 0, 0, Math.PI * 2);
                hCtx.fill();
            }
        }
    } else if (style === 'leaves') {
        // 树叶：叠放的叶片脉络
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 70; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const len = Math.random() * 70 + 30;
            const ang = Math.random() * Math.PI;
            hCtx.save();
            hCtx.translate(x, y);
            hCtx.rotate(ang);
            const grad = hCtx.createLinearGradient(0, 0, len, 0);
            grad.addColorStop(0, 'rgba(255,255,255,0.60)');
            grad.addColorStop(1, 'rgba(60,60,60,0.30)');
            hCtx.fillStyle = grad;
            hCtx.beginPath();
            hCtx.ellipse(len / 2, 0, len / 2, len / 6, 0, 0, Math.PI * 2);
            hCtx.fill();
            hCtx.strokeStyle = 'rgba(0,0,0,0.25)';
            hCtx.lineWidth = 1.5;
            hCtx.beginPath(); hCtx.moveTo(0, 0); hCtx.lineTo(len, 0); hCtx.stroke();
            hCtx.restore();
        }
    } else if (style === 'camouflage') {
        // 迷彩：不规则色块
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const tones = ['rgba(120,120,120,0.85)', 'rgba(200,200,200,0.85)', 'rgba(60,60,60,0.85)', 'rgba(160,160,160,0.85)'];
        for (let i = 0; i < 60; i++) {
            hCtx.fillStyle = tones[i % tones.length];
            const x = Math.random() * res, y = Math.random() * res;
            hCtx.beginPath();
            const pts = 7;
            for (let k = 0; k < pts; k++) {
                const a = (k / pts) * Math.PI * 2;
                const r = Math.random() * 46 + 16;
                const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
                if (k === 0) hCtx.moveTo(px, py); else hCtx.lineTo(px, py);
            }
            hCtx.closePath();
            hCtx.fill();
        }
    } else if (style === 'rain_streak') {
        // 雨痕：顺着风向的细长水迹
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 1600; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const len = Math.random() * 40 + 8;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
            hCtx.lineWidth = Math.random() * 1.4 + 0.4;
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            hCtx.lineTo(x + len * 0.25, y + len);
            hCtx.stroke();
        }
    } else if (style === 'sandstone') {
        // 砂岩：水平层理 + 颗粒
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let y = 0; y < res; y += 3) {
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
            hCtx.fillRect(0, y, res, 2);
        }
        for (let i = 0; i < 7000; i++) {
            hCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.24)';
            hCtx.fillRect(Math.random() * res, Math.random() * res, 2, 1);
        }
    } else if (style === 'crumple') {
        // 揉皱纸：大折痕 + 细碎裂纹
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 46; i++) {
            let x = Math.random() * res, y = Math.random() * res;
            hCtx.lineWidth = Math.random() * 3 + 1;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)';
            hCtx.beginPath();
            hCtx.moveTo(x, y);
            for (let s = 0; s < 6; s++) {
                x += (Math.random() - 0.5) * res * 0.35;
                y += (Math.random() - 0.5) * res * 0.35;
                hCtx.lineTo(x, y);
            }
            hCtx.stroke();
        }
    } else if (style === 'glitter') {
        // 闪粉：细密亮点
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 14000; i++) {
            const bright = Math.random() > 0.45;
            hCtx.fillStyle = bright ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)';
            const s = Math.random() * 2.2 + 0.6;
            hCtx.beginPath();
            hCtx.arc(Math.random() * res, Math.random() * res, s, 0, Math.PI * 2);
            hCtx.fill();
        }
    } else if (style === 'brushed_metal') {
        // 拉丝金属：单向长丝
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 3000; i++) {
            const y = Math.random() * res;
            const x = Math.random() * res;
            const len = Math.random() * 120 + 20;
            hCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.26)';
            hCtx.lineWidth = 1;
            hCtx.beginPath(); hCtx.moveTo(x, y); hCtx.lineTo(x + len, y + (Math.random() - 0.5) * 2); hCtx.stroke();
        }
    } else if (style === 'honeycomb') {
        // 蜂窝：六边形格
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        const hr = 18;
        hCtx.lineWidth = 3;
        hCtx.strokeStyle = 'rgba(255,255,255,0.55)';
        for (let row = 0; row < res / (hr * 1.5) + 2; row++) {
            for (let col = 0; col < res / (hr * 1.75) + 2; col++) {
                const cx = col * hr * 1.75 + (row % 2 ? hr * 0.875 : 0);
                const cy = row * hr * 1.5;
                hCtx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const a = Math.PI / 3 * k;
                    const px = cx + hr * Math.cos(a), py = cy + hr * Math.sin(a);
                    if (k === 0) hCtx.moveTo(px, py); else hCtx.lineTo(px, py);
                }
                hCtx.closePath();
                hCtx.stroke();
            }
        }
    } else if (style === 'fleece') {
        // 抓绒：细密乱的绒团
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = 0; i < 900; i++) {
            const x = Math.random() * res, y = Math.random() * res;
            const r = Math.random() * 7 + 2;
            const grad = hCtx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, Math.random() > 0.5 ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)');
            grad.addColorStop(1, 'rgba(128,128,128,0)');
            hCtx.fillStyle = grad;
            hCtx.beginPath(); hCtx.arc(x, y, r, 0, Math.PI * 2); hCtx.fill();
        }
    }

    const hData = hCtx.getImageData(0, 0, res, res).data;
    const nData = hCtx.createImageData(res, res);
    const strength = 3.0;
    for(let y=0; y<res; y++) {
        for(let x=0; x<res; x++) {
            const idx = (y * res + x) * 4;
            const leftX = (x - 1 + res) % res;
            const rightX = (x + 1) % res;
            const upY = (y - 1 + res) % res;
            const downY = (y + 1) % res;
            const hL = hData[(y * res + leftX) * 4] / 255;
            const hR = hData[(y * res + rightX) * 4] / 255;
            const hU = hData[(upY * res + x) * 4] / 255;
            const hD = hData[(downY * res + x) * 4] / 255;
            const dx = (hR - hL) * strength;
            const dy = (hD - hU) * strength;
            const len = Math.sqrt(dx*dx + dy*dy + 1.0);
            const nx = dx / len;
            const ny = dy / len;
            const nz = 1.0 / len;
            nData.data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            nData.data[idx+1] = Math.floor((ny * 0.5 + 0.5) * 255);
            nData.data[idx+2] = Math.floor((nz * 0.5 + 0.5) * 255);
            nData.data[idx+3] = 255;
        }
    }
    hCtx.putImageData(nData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (renderer && renderer.capabilities) {
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    if ('colorSpace' in tex) tex.colorSpace = THREE.LinearSRGBColorSpace;
    return tex;
}

function createWaterDropNormalMap(sizeMul = 1.0, densityMul = 1.0) {
    const res = 512;
    const canvas = document.createElement('canvas');
    canvas.width = res; canvas.height = res;
    const hCtx = canvas.getContext('2d');

    hCtx.fillStyle = '#808080';
    hCtx.fillRect(0, 0, res, res);

    const baseCount = 150;
    const baseRMin = 10;
    const baseRMax = 26;

    const dropCount = Math.max(20, Math.min(800, Math.floor(baseCount * densityMul)));
    const rMin = Math.max(2, baseRMin * sizeMul);
    const rMax = Math.max(rMin + 1, baseRMax * sizeMul);

    for (let i = 0; i < dropCount; i++) {
        const x = Math.random() * res;
        const y = Math.random() * res;
        const r = Math.random() * (rMax - rMin) + rMin;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const px = x + ox * res;
                const py = y + oy * res;
                if (px + r > 0 && px - r < res && py + r > 0 && py - r < res) {
                    const grad = hCtx.createRadialGradient(px - r * 0.25, py - r * 0.25, 0, px, py, r);
                    grad.addColorStop(0, '#ffffff');
                    grad.addColorStop(0.45, '#f0f0f0');
                    grad.addColorStop(0.8, '#b0b0b0');
                    grad.addColorStop(1, '#808080');
                    hCtx.fillStyle = grad;
                    hCtx.beginPath();
                    hCtx.arc(px, py, r, 0, Math.PI * 2);
                    hCtx.fill();
                }
            }
        }
    }

    const hData = hCtx.getImageData(0, 0, res, res).data;
    const nData = hCtx.createImageData(res, res);
    const strength = 3.5;
    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            const idx = (y * res + x) * 4;
            const leftX = (x - 1 + res) % res;
            const rightX = (x + 1) % res;
            const upY = (y - 1 + res) % res;
            const downY = (y + 1) % res;
            const hL = hData[(y * res + leftX) * 4] / 255;
            const hR = hData[(y * res + rightX) * 4] / 255;
            const hU = hData[(upY * res + x) * 4] / 255;
            const hD = hData[(downY * res + x) * 4] / 255;
            const dx = (hR - hL) * strength;
            const dy = (hD - hU) * strength;
            const len = Math.sqrt(dx * dx + dy * dy + 1.0);
            nData.data[idx]     = Math.floor((dx / len * 0.5 + 0.5) * 255);
            nData.data[idx + 1] = Math.floor((dy / len * 0.5 + 0.5) * 255);
            nData.data[idx + 2] = Math.floor((1.0 / len * 0.5 + 0.5) * 255);
            nData.data[idx + 3] = 255;
        }
    }
    hCtx.putImageData(nData, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (renderer && renderer.capabilities) {
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    if ('colorSpace' in tex) tex.colorSpace = THREE.LinearSRGBColorSpace;
    return tex;
}

function ensureDummyNormal() {
    if (dummyNormalTexture) return dummyNormalTexture;
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const cx = c.getContext('2d');
    cx.fillStyle = '#808080';
    cx.fillRect(0, 0, 1, 1);
    dummyNormalTexture = new THREE.CanvasTexture(c);
    dummyNormalTexture.wrapS = THREE.RepeatWrapping;
    dummyNormalTexture.wrapT = THREE.RepeatWrapping;
    if ('colorSpace' in dummyNormalTexture) dummyNormalTexture.colorSpace = THREE.LinearSRGBColorSpace;
    return dummyNormalTexture;
}

function scheduleRegenerateWaterTexture() {
    if (waterTexRebuildTimer) clearTimeout(waterTexRebuildTimer);
    waterTexRebuildTimer = setTimeout(() => {
        waterTexRebuildTimer = null;
        if (!waterEnabled) return;
        if (waterDropNormalTexture) {
            waterDropNormalTexture.dispose();
        }
        waterDropNormalTexture = createWaterDropNormalMap(waterDropSize, waterDropDensity);
        if (clothMesh && lightEnabled) {
            switchClothMaterial();
        }
    }, 120);
}

function pourWater() {
    console.log("=== 开始执行泼水 ===");
    
    if (!cloth || !clothMesh) {
        console.error("【泼水失败】布料未生成");
        alert(window.I18N[window.currentLang].alert_no_cloth || "请先生成布料！");
        return;
    }
    
    if (!lightEnabled) {
        console.error("【泼水失败】未开启光影");
        alert(window.I18N[window.currentLang].alert_need_light || "请先开启光影！");
        return;
    }

    console.log("【泼水成功】开始生成水珠纹理...");

    // 原本的代码继续往下...
    if (waterDropNormalTexture) {
        waterDropNormalTexture.dispose();
    }
    waterDropNormalTexture = createWaterDropNormalMap(waterDropSize, waterDropDensity);
    waterEnabled = true;

    const centers = [];
    const numCenters = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numCenters; i++) {
        centers.push({
            x: (Math.random() - 0.5) * 1.5,
            y: (Math.random() - 0.5) * 1.5,
            r: Math.random() * 0.4 + 0.4
        });
    }

    let totalW = 0;
    for (let p of cloth.particles) {
        let maxWet = 0;
        for (let c of centers) {
            const d = Math.hypot(p.x - c.x, p.y - c.y);
            if (d < c.r) {
                const t = 1.0 - (d / c.r);
                const smoothT = t * t * (3 - 2 * t);
                maxWet = Math.max(maxWet, smoothT * waterMaxWetness);
            }
        }
        p.wetness = maxWet;
        totalW += p.wetness;
    }

    const arr = cloth.geometry.attributes.wetness.array;
    for (let i = 0; i < cloth.particles.length; i++) {
        arr[i] = cloth.particles[i].wetness / waterMaxWetness;
    }
    cloth.geometry.attributes.wetness.needsUpdate = true;

    clothWetness = totalW;
    const avgWet = (totalW / cloth.particles.length) / waterMaxWetness * 100;
    wetnessValueEl.textContent = avgWet.toFixed(1) + "%";
    lastWetnessPercent = avgWet;

    switchClothMaterial();
}

function updateWetness(dt) {
    if (!cloth || !clothMesh) return;
    let totalWet = 0;
    let anyWet = false;
    let totalSpeed = 0;
    for (let i = 0; i < cloth.particles.length; i++) {
        const p = cloth.particles[i];
        const vx = p.x - p.oldX;
        const vy = p.y - p.oldY;
        const vz = p.z - p.oldZ;
        totalSpeed += Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    const avgSpeed = totalSpeed / cloth.particles.length;
    const t = Math.max(0, Math.min(1, (avgSpeed - shakeSpeedThreshold) / shakeSpeedRange));
    const smoothT = t * t * (3 - 2 * t);

    const evapBase = evaporationSpeed * dt;
    const evapShake = smoothT * shakeDryingFactor * dt;
    const totalEvap = evapBase + evapShake;

    for (let p of cloth.particles) {
        if (p.wetness > 0) {
            p.wetness = Math.max(0, p.wetness - totalEvap);
            anyWet = true;
        }
        totalWet += p.wetness;
    }

    if (anyWet || clothWetness > 0) {
        clothWetness = totalWet;
        const arr = cloth.geometry.attributes.wetness.array;
        for (let i = 0; i < cloth.particles.length; i++) {
            arr[i] = cloth.particles[i].wetness / waterMaxWetness;
        }
        cloth.geometry.attributes.wetness.needsUpdate = true;

        const percent = Math.round((totalWet / cloth.particles.length) / waterMaxWetness * 1000) / 10;
        if (percent !== lastWetnessPercent) {
            wetnessValueEl.textContent = percent.toFixed(1) + "%";
            lastWetnessPercent = percent;
        }
    }
}

function updatePbrTextures() {
    if (pbrBaseNormalTexture && pbrBaseNormalTexture !== pbrCustomNormalTexture) {
        pbrBaseNormalTexture.dispose();
    }
    if (pbrNoiseNormalTexture) {
        pbrNoiseNormalTexture.dispose();
    }
    if (pbrAlphaTexture) {
        pbrAlphaTexture.dispose();
    }
    pbrBaseNormalTexture = null;
    pbrNoiseNormalTexture = null;
    pbrAlphaTexture = null;

    if (pbrCustomNormalTexture) {
        pbrBaseNormalTexture = pbrCustomNormalTexture;
    } else if (currentPbrType === "none" && !pbrNoiseEnabled) {
        // Both empty
    } else if (currentPbrType !== "none") {
        const result = createProceduralNormalMap(currentPbrType);
        pbrBaseNormalTexture = result.normalTex;
        pbrAlphaTexture = result.alphaTex;
    }

    if (pbrNoiseEnabled) {
        pbrNoiseNormalTexture = createNoiseNormalMap(pbrNoiseStyle);
    }

    if (!pbrBaseNormalTexture && pbrNoiseNormalTexture) {
        const dummyCanvas = document.createElement('canvas');
        dummyCanvas.width = 1; dummyCanvas.height = 1;
        const dCtx = dummyCanvas.getContext('2d');
        dCtx.fillStyle = '#808080';
        dCtx.fillRect(0, 0, 1, 1);
        pbrBaseNormalTexture = new THREE.CanvasTexture(dummyCanvas);
        pbrBaseNormalTexture.wrapS = THREE.RepeatWrapping;
        pbrBaseNormalTexture.wrapT = THREE.RepeatWrapping;
    }
    applyPbrRepeat();
}

function applyPbrRepeat() {
    const baseRepeat = Math.max(0.1, pbrTexSize);
    const noiseRepeat = Math.max(0.1, pbrNoiseSize);
    
    if (pbrBaseNormalTexture) {
        // 🟢 修复：如果是自定义法线图，说明它本身就是按底图比例做的，不能强行拉伸
        if (pbrBaseNormalTexture === pbrCustomNormalTexture) {
            pbrBaseNormalTexture.repeat.set(baseRepeat, baseRepeat);
        } else {
            // 程序化生成的贴图是正方形，需要按 imgAspect 补偿防止拉伸
            let baseRepX = baseRepeat, baseRepY = baseRepeat;
            if (imgAspect >= 1) {
                baseRepX = baseRepeat * imgAspect;
            } else {
                baseRepY = baseRepeat / imgAspect;
            }
            pbrBaseNormalTexture.repeat.set(baseRepX, baseRepY);
        }
    }
    
    if (pbrNoiseNormalTexture) {
        let noiseRepX = noiseRepeat, noiseRepY = noiseRepeat;
        if (imgAspect >= 1) {
            noiseRepX = noiseRepeat * imgAspect;
        } else {
            noiseRepY = noiseRepeat / imgAspect;
        }
        pbrNoiseNormalTexture.repeat.set(noiseRepX, noiseRepY);
    }
    
    if (pbrAlphaTexture) {
        let alphaRepX = baseRepeat, alphaRepY = baseRepeat;
        if (imgAspect >= 1) {
            alphaRepX = baseRepeat * imgAspect;
        } else {
            alphaRepY = baseRepeat / imgAspect;
        }
        pbrAlphaTexture.repeat.set(alphaRepX, alphaRepY);
    }
    
    if (activeShaderRef) {
        if (pbrBaseNormalTexture && activeShaderRef.uniforms.uNormalRepeat) {
            activeShaderRef.uniforms.uNormalRepeat.value.copy(pbrBaseNormalTexture.repeat);
        }
        if (pbrNoiseNormalTexture && activeShaderRef.uniforms.uNoiseRepeat) {
            activeShaderRef.uniforms.uNoiseRepeat.value.copy(pbrNoiseNormalTexture.repeat);
        }
    }
    if (clothMesh) switchClothMaterial();
    if (thicknessEnabled) updateThicknessMesh();
}

pbrTextureSelect.onchange = () => {
    currentPbrType = pbrTextureSelect.value;
    if (pbrCustomNormalTexture) {
        pbrCustomNormalTexture.dispose();
        pbrCustomNormalTexture = null;
        customNormalCtrl.style.display = "none";
        customNormalInput.value = "";
    }
    const showSizeCtrl = (currentPbrType !== "none" || pbrNoiseEnabled || pbrCustomNormalTexture);
    pbrTexSizeCtrl.style.display = showSizeCtrl ? "grid" : "none";
    pbrNormalScaleCtrl.style.display = showSizeCtrl ? "grid" : "none";
    if (currentPbrType !== "none" && !lightEnabled) {
        toggleLight.checked = true;
        toggleLight.dispatchEvent(new Event('change'));
    }
    updatePbrTextures();
};

togglePbrNoise.onchange = () => {
    pbrNoiseEnabled = togglePbrNoise.checked;
    pbrNoiseCtrl.style.display = pbrNoiseEnabled ? "grid" : "none";
    pbrNoiseIntensityCtrl.style.display = pbrNoiseEnabled ? "grid" : "none";
    pbrNoiseSizeCtrl.style.display = pbrNoiseEnabled ? "grid" : "none";
    const showSizeCtrl = (currentPbrType !== "none" || pbrNoiseEnabled || pbrCustomNormalTexture);
    pbrTexSizeCtrl.style.display = showSizeCtrl ? "grid" : "none";
    pbrNormalScaleCtrl.style.display = showSizeCtrl ? "grid" : "none";
    if (pbrNoiseEnabled && !lightEnabled) {
        toggleLight.checked = true;
        toggleLight.dispatchEvent(new Event('change'));
    }
    updatePbrTextures();
};

pbrNoiseStyleSelect.onchange = () => {
    pbrNoiseStyle = pbrNoiseStyleSelect.value;
    if (pbrNoiseEnabled) updatePbrTextures();
};

let userCustomNormals = []; // 存储 { id, name, texture }

const customNormalSelect = document.getElementById("customNormalSelect");
const btnDeleteCustomNormal = document.getElementById("btnDeleteCustomNormal");

customNormalInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if ('colorSpace' in tex) tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.needsUpdate = true;
        
        const id = 'normal_' + Date.now();
        userCustomNormals.push({ id, name: file.name.replace(/\.[^/.]+$/, ""), texture: tex });
        updateCustomNormalUI();
        
        // 自动应用刚上传的
        if (customNormalSelect) customNormalSelect.value = id;
        applySelectedNormalTexture(id);
        
        URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
};

function updateCustomNormalUI() {
    if (!customNormalSelect) return;
    if (userCustomNormals.length === 0) {
        customNormalSelect.innerHTML = `<option value="" disabled selected>暂无自定义法线</option>`;
        return;
    }
    customNormalSelect.innerHTML = userCustomNormals.map(n => 
        `<option value="${n.id}">🖼️ ${n.name}</option>`
    ).join('');
}

if (customNormalSelect) {
    customNormalSelect.onchange = () => {
        applySelectedNormalTexture(customNormalSelect.value);
    };
}

function applySelectedNormalTexture(id) {
    if (pbrCustomNormalTexture) {
        pbrCustomNormalTexture.dispose();
        pbrCustomNormalTexture = null;
    }
    
    if (id) {
        const target = userCustomNormals.find(n => n.id === id);
        if (target) {
            pbrCustomNormalTexture = target.texture;
            pbrCustomNormalTexture.needsUpdate = true;
            
            customNormalCtrl.style.display = "flex";
            pbrTextureSelect.value = "none";
            currentPbrType = "none";
            
            const showSizeCtrl = (pbrNoiseEnabled || pbrCustomNormalTexture);
            pbrTexSizeCtrl.style.display = showSizeCtrl ? "grid" : "none";
            pbrNormalScaleCtrl.style.display = showSizeCtrl ? "grid" : "none";
            
            if (!lightEnabled) {
                toggleLight.checked = true;
                toggleLight.dispatchEvent(new Event('change'));
            }
            updatePbrTextures();
        }
    } else {
        customNormalCtrl.style.display = "none";
        updatePbrTextures();
    }
}

if (btnDeleteCustomNormal) {
    btnDeleteCustomNormal.onclick = () => {
        const targetId = customNormalSelect.value;
        if (!targetId) return;
        if (!confirm("确定删除该法线贴图吗？")) return;
        
        const target = userCustomNormals.find(n => n.id === targetId);
        if (target && target.texture) target.texture.dispose();
        
        userCustomNormals = userCustomNormals.filter(n => n.id !== targetId);
        updateCustomNormalUI();
        
        // 如果删除的是当前正在使用的，就清除
        if (pbrCustomNormalTexture === (target && target.texture)) {
            clearCustomNormalBtn.onclick(); // 复用原来的清除逻辑
        }
    };
}

// 替换原来的 clearCustomNormalBtn.onclick，防止直接丢弃导致内存泄漏
clearCustomNormalBtn.onclick = () => {
    if (pbrCustomNormalTexture) pbrCustomNormalTexture.dispose();
    pbrCustomNormalTexture = null;
    customNormalCtrl.style.display = "none";
    customNormalInput.value = "";
    if (customNormalSelect) customNormalSelect.value = "";
    
    const showSizeCtrl = (currentPbrType !== "none" || pbrNoiseEnabled);
    pbrTexSizeCtrl.style.display = showSizeCtrl ? "grid" : "none";
    pbrNormalScaleCtrl.style.display = showSizeCtrl ? "grid" : "none";
    updatePbrTextures();
};

function applyMaterialProps() {
    const applyPhysProps = (m) => {
        if ("transmission" in m) m.transmission = clothTransmission;
        if ("clearcoat" in m) m.clearcoat = clothClearcoat;
        if ("ior" in m) m.ior = clothIor;
        if ("thickness" in m) m.thickness = clothThickness;
        if ("attenuationDistance" in m) m.attenuationDistance = clothAttenuation === 0 ? Infinity : clothAttenuation;
        if ("attenuationColor" in m) m.attenuationColor.set(clothAttenuationColor);
        if ("iridescence" in m) m.iridescence = clothIridescence;
        if ("iridescenceIOR" in m) m.iridescenceIOR = clothIridescenceIor;
        if ("sheen" in m) m.sheen = clothSheen;
        if ("sheenColor" in m) m.sheenColor.set(clothSheenColor);
        if ("sheenRoughness" in m) m.sheenRoughness = clothSheenRoughness;
        
        // 如果有透射，必须开启透明渲染
        if (clothTransmission > 0) {
            m.transparent = true;
            m.depthWrite = false;
        }
    };
    const rough = parseFloat(roughnessSlider.value);
    const metal = parseFloat(metalnessSlider.value);
    const applyToMat = (m) => {
        if ("roughness" in m) m.roughness = rough;
        if ("metalness" in m) m.metalness = metal;
        m.opacity = clothOpacity;
        if (pbrAlphaTexture) {
            m.transparent = true;
            m.alphaTest = 0.5;
            m.depthWrite = false;
            m.alphaMap = pbrAlphaTexture;
            m.opacity = Math.max(clothOpacity, 0.15);
        } else {
            m.transparent = clothOpacity < 1.0;
            m.alphaTest = 0;
            m.depthWrite = clothOpacity >= 1.0;
            m.alphaMap = null;
        }
        if (m.isMeshStandardMaterial || m.isMeshToonMaterial) {
            let baseNormal = pbrBaseNormalTexture;
            if (!baseNormal && waterEnabled) {
                baseNormal = ensureDummyNormal();
            }
            m.normalMap = baseNormal;
            if (baseNormal) m.normalScale.set(pbrNormalScale, pbrNormalScale);
        } else {
            m.normalMap = null;
        }
        m.needsUpdate = true;
    };
    if (clothMesh && clothMesh.material) applyToMat(clothMesh.material);
    if (thicknessMat) applyToMat(thicknessMat);
    if (outlineMat) {
        outlineMat.opacity = clothOpacity;
        outlineMat.transparent = clothOpacity < 1.0;
        outlineMat.depthWrite = clothOpacity >= 1.0;
        outlineMat.needsUpdate = true;
    }
}

toggleFlat.onchange = () => {
    flatShadingEnabled = toggleFlat.checked;
    materialPresetSelect.value = "custom";
    if (clothMesh) switchClothMaterial();
    if (thicknessMat) {
        thicknessMat.flatShading = flatShadingEnabled;
        thicknessMat.needsUpdate = true;
    }
};

function updateOutlineMesh() {
    if (!clothMesh || !cloth || !outlineEnabled) {
        if (outlineMesh) {
            detachFromScene(outlineMesh);
            outlineMesh.geometry.dispose();
            outlineMat.dispose();
            outlineMesh = null;
            outlineMat = null;
        }
        return;
    }
    const thick = parseFloat(outlineThickSlider.value);
    if (!outlineMesh) {
        outlineMat = new THREE.MeshBasicMaterial({
            color: outlineColorInput.value,
            // 描边是"反向壳"：必须只画背面、且不写深度，否则它会把布料正面盖住
            side: THREE.BackSide,
            transparent: clothOpacity < 1.0,
            opacity: clothOpacity,
            depthWrite: false,
            depthTest: true
        });
        outlineMesh = new THREE.Mesh(clothMesh.geometry.clone(), outlineMat);
        outlineMesh.frustumCulled = false;
        outlineMesh.renderOrder = 2;       // 永远画在布料之后
        outlineMesh.castShadow = shadowEnabled;
        (sceneHolder || scene).add(outlineMesh);
    }
    const srcPos = clothMesh.geometry.attributes.position;
    // 🪶 低配模式可能跳过法线计算，这里兜底补算一次，避免描边拿到 undefined
    if (!clothMesh.geometry.attributes.normal) clothMesh.geometry.computeVertexNormals();
    const nor = clothMesh.geometry.attributes.normal;
    let dst = outlineMesh.geometry.attributes.position;
    if (!dst || dst.count !== srcPos.count) {
        outlineMesh.geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(srcPos.array.length), 3));
        dst = outlineMesh.geometry.attributes.position;
    }
    const sArr = srcPos.array, nArr = nor.array, dArr = dst.array;
    for (let i = 0; i < sArr.length; i++) {
        dArr[i] = sArr[i] + nArr[i] * thick;
    }
    dst.needsUpdate = true;
    outlineMat.color.set(outlineColorInput.value);
}

function updateThicknessMesh() {
    if (!clothMesh || !cloth || !thicknessEnabled) {
        if (thicknessMesh) {
            detachFromScene(thicknessMesh);
            if (thicknessMat) thicknessMat.dispose();
            thicknessMesh = null; thicknessMat = null;
        }
        return;
    }
    if (!thicknessMesh) {
        thicknessMesh = new THREE.Mesh(cloth.thicknessGeometry, null);
        thicknessMesh.frustumCulled = false;
        // ⚠️ 厚度壳**必须画在正面之后**：
        // 以前是 renderOrder = -1（先画），它的底面是沿法线**向外偏移**的一层，
        // 于是它会把正面的像素盖住 —— 表现就是"正面被剔除、只看到背面的图案"（或者直接镂空）。
        // 现在就让它跟在正面后面画，并且不写深度，只在正面已经画完的像素上叠加侧壁。
        thicknessMesh.renderOrder = 1;
        thicknessMesh.castShadow = shadowEnabled;
        (sceneHolder || scene).add(thicknessMesh);
    }
    if (thicknessMat) thicknessMat.dispose();
    const useTex = thicknessTexEnabled && textureEnabled && imageTexture;
    const isTrans = clothOpacity < 1.0;
    const depthW = false;          // 厚度壳不写深度（避免与布料正/反面互相剔除）
    if (lightEnabled) {
        thicknessMat = new THREE.MeshStandardMaterial({
            color: useTex ? 0xffffff : thicknessColorInput.value,
            map: useTex ? imageTexture : null,
            side: THREE.DoubleSide,          // 双面渲染：不做背面剔除
            roughness: parseFloat(roughnessSlider.value),
            metalness: parseFloat(metalnessSlider.value),
            flatShading: flatShadingEnabled,
            envMapIntensity: 0.3,
            transparent: isTrans,
            opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
            depthWrite: depthW,
            depthTest: true,
            normalMap: pbrBaseNormalTexture,
            normalScale: new THREE.Vector2(pbrNormalScale, pbrNormalScale),
            alphaMap: pbrAlphaTexture,
            alphaTest: pbrAlphaTexture ? 0.5 : 0
        });
    } else {
        thicknessMat = new THREE.MeshBasicMaterial({
            color: useTex ? 0xffffff : thicknessColorInput.value,
            map: useTex ? imageTexture : null,
            side: THREE.DoubleSide,          // 双面渲染：不做背面剔除
            wireframe: showGrid,
            transparent: isTrans,
            opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
            depthWrite: depthW,
            alphaMap: pbrAlphaTexture,
            alphaTest: pbrAlphaTexture ? 0.5 : 0
        });
    }
    thicknessMesh.material = applyDoubleSide(thicknessMat);
}

lightStyleSelect.onchange = () => {
    if (clothMesh) { switchClothMaterial(); clothMesh.material.wireframe = showGrid; }
};

function makeToonGradient(steps) {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = 1;
    const c = canvas.getContext("2d");
    const grad = c.createLinearGradient(0, 0, size, 0);
    for (let i = 0; i <= steps; i++) {
        const pos = i / steps, v = Math.floor(pos * 255);
        grad.addColorStop(pos, `rgb(${v},${v},${v})`);
    }
    c.fillStyle = grad; c.fillRect(0, 0, size, 1);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    return tex;
}

// 渔网：没有选 PBR 法线时，用一张程序化网眼 alphaMap 做镂空（不依赖任何 PBR 预设）
let fishnetAlphaCache = null;
function makeFishnetAlphaMap() {
    if (fishnetAlphaCache) return fishnetAlphaCache;
    const s = 512;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const g = c.getContext("2d");
    g.fillStyle = "#000000";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "#ffffff";
    g.lineCap = "round";
    g.lineWidth = s / 42;
    for (let i = -s; i < s * 2; i += s / 12) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
        g.beginPath(); g.moveTo(i, s); g.lineTo(i + s, 0); g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    fishnetAlphaCache = tex;
    return tex;
}

/**
 * 🪞 正反面区分：给布料材质注入"背面压暗"。
 * 布料只有一个面片 + DoubleSide，从背面看是同一张图（镜像），3D 视角里翻卷时
 * 很容易分不清哪一面朝自己。这里用 gl_FrontFacing 在片元阶段把背面压暗并轻微去饱和，
 * 不需要第二套材质、也不影响正面颜色。
 * 注意要挂到已有 onBeforeCompile 之上（链式），不能覆盖它（那会丢掉法线/水珠/镭射注入）。
 *
 * ⚠️ 千万别在片元里用 uniform 判断（`uBackShade > 0.001`）后**自定义 secondpass 的宏**：
 * 那个分支只有在 uBackShade 命中时才动 gl_FragColor，本身无害；但这里保留纯 uniform
 * 是为了让 customProgramCacheKey 稳定（不因运行时数值变化而重编译）。
 */
function installBackShade(mat) {
    if (!mat || mat.userData._backShade) return;
    mat.userData._backShade = true;
    const prev = mat.onBeforeCompile;
    const patch = (shader) => {
        shader.uniforms.uBackShade = { value: backShadeStrength };
        shader.uniforms.uBackHide = { value: backHidePrint };
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nuniform float uBackShade;\nuniform float uBackHide;\n'
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <dithering_fragment>',
            `#include <dithering_fragment>
            if (!gl_FrontFacing) {
                // 背面用"素布底色"收一下：正面印花正常，翻过去那层不再把镜像印花透成一重影
                if (uBackHide > 0.001) {
                    float backLum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                    vec3 clothTone = vec3(backLum) * 0.92 + vec3(0.855, 0.845, 0.835) * 0.08;
                    gl_FragColor.rgb = mix(gl_FragColor.rgb, clothTone, uBackHide);
                }
                if (uBackShade > 0.001) {
                    float backGray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                    vec3 backDesat = mix(vec3(backGray), gl_FragColor.rgb, 0.82);
                    gl_FragColor.rgb = backDesat * (1.0 - uBackShade);
                }
            }
            `
        );
    };
    mat.onBeforeCompile = (shader, renderer) => {
        if (prev) prev(shader, renderer);
        patch(shader);
    };
    // 让 three 把"改过 shader"这件事纳入程序缓存键（否则可能复用旧程序）
    const prevKey = mat.customProgramCacheKey;
    mat.customProgramCacheKey = function () {
        const base = prevKey ? prevKey.call(this) : "";
        return base + "|backshade" + backShadeStrength;
    };
    mat.needsUpdate = true;
}

/**
 * 🎭 强制双面渲染（关闭背面剔除）
 * ------------------------------------------------------------------
 * 布料只有一层三角面；只要材质的 side 变成 FrontSide（或因为法线朝向反了、
 * 模型矩阵出现负行列式），正面多边形就会被剔除 —— 表现就是"正面镂空，只看到背面"。
 * 这里把所有布料相关材质统一钉死成 DoubleSide + 正常深度测试，
 * 不动拓扑 / UV / 贴图。
 */
function applyDoubleSide(mat) {
    if (!mat) return mat;
    mat.side = THREE.DoubleSide;
    mat.depthTest = true;              // 仍然做深度测试，避免"视觉穿模"
    // 注意：这里不强制 depthWrite，透明材质那边已经单独处理过
    if (mat.shadowSide === undefined) mat.shadowSide = THREE.DoubleSide;
    else mat.shadowSide = THREE.DoubleSide;
    mat.needsUpdate = true;
    return mat;
}

function updateClothDepthPolicy(mat) {
    if (!mat || !cloth) return mat;
    const opacity = Number.isFinite(clothOpacity) ? clothOpacity : 1.0;
    const opaqueEnough = opacity >= 0.999;
    const hasAlphaMask = !!(mat.alphaMap && mat.alphaTest > 0) || !!mat.alphaTest;
    // 只要"不透明 或 有 alphaTest 镂空"，就必须写深度 —— 否则前后两层都会被画出来，
    // 表现为"背面褶皱透出来 / 穿模"（物理上其实没穿，只是深度没挡住）。
    if (opaqueEnough || hasAlphaMask) {
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
        mat.side = THREE.DoubleSide;       // 保持双面，但只是"同一层的前后两个面"都画
    } else {
        // 半透明：保留深度写入，只让 alpha 决定通透；
        // 不写深度会重新出现"内部面片透出来"，所以这里也强制 depthWrite = true。
        mat.transparent = true;
        mat.opacity = opacity;
        mat.depthWrite = true;
    }
    mat.depthTest = true;
    mat.alphaToCoverage = false;
    mat.needsUpdate = true;
    return mat;
}

function switchClothMaterial() {
    if (!clothMesh) return;
    clothMesh.material.dispose();
    // 🪶 材质类型变了（尤其是低配模式跳过法线之后切回光照材质），下一帧强制重算法线
    if (cloth) cloth._forceNormals = true;
    const rough = parseFloat(roughnessSlider.value);
    const metal = parseFloat(metalnessSlider.value);
    const isTrans = clothOpacity < 1.0;
    // ⚠️ 曾经这里写的是 `pbrAlphaTexture === null && tearTexture === null`：
    // 但 tearCanvas / tearTexture 在启动时就创建，永远非 null，
    // 于是布料被永久判成"半透明 + 不写深度" —— 前后两层都会画出来，
    // 表现正是"背面褶皱透过正面显示 / 穿模"。镂空贴图靠 alphaTest 就够了。
    const depthW = true;
    const hasPbr = pbrBaseNormalTexture !== null || pbrNoiseNormalTexture !== null;
    const hasWater = waterEnabled && lightEnabled;
    const needsShader = hasPbr || hasWater || pbrAlphaTexture !== null || holoEnabled;

    // ============================================================
    // 🔧 修复要点：泼水 / 镭射 时必须给 normalMap 一个非 null 的占位，
    //    否则 Three.js 不会定义 USE_NORMALMAP_TANGENTSPACE 宏，
    //    onBeforeCompile 里的水珠 / 镭射片段就会被整块跳过。
    // ============================================================
    let baseNormalForShader = pbrBaseNormalTexture;
    if (!baseNormalForShader && (holoEnabled || hasWater)) {
        baseNormalForShader = ensureDummyNormal();
    }
    // 判断当前用的是否是 1x1 中性灰占位图（true 时 repeat 必须为 1）
    const useDummyNormal = baseNormalForShader &&
        baseNormalForShader === dummyNormalTexture &&
        !pbrBaseNormalTexture;

    const useLighting = lightEnabled || hasPbr;
    let mat;

    let finalAlphaMap = pbrAlphaTexture;
    if (!finalAlphaMap && tearTexture) finalAlphaMap = tearTexture;
    // 🕸 渔网：没选 PBR 网眼时用程序化网眼做镂空（与 PBR 预设无关）
    const isFishnet = materialPresetSelect && materialPresetSelect.value === "fishnet";
    const isFishnetAlpha = isFishnet && finalAlphaMap === fishnetAlphaCache;
    if (!finalAlphaMap && isFishnet) {
        finalAlphaMap = makeFishnetAlphaMap();
        if (finalAlphaMap) finalAlphaMap.repeat.set(pbrTexSize, pbrTexSize);
    }

    if (useLighting) {
        if (lightEnabled && lightStyleSelect.value === "toonShadow") {
            // ---------- 三渲二 ----------
            const toonGrad = makeToonGradient(parseInt(toonStepsSlider.value));
            const toonProps = {
                color: textureEnabled && imageTexture ? 0xffffff : new THREE.Color(currentClothColor),
                map: textureEnabled && imageTexture ? imageTexture : null,
                side: THREE.DoubleSide,
                transparent: isTrans,
                opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
                depthWrite: depthW,
                gradientMap: toonGrad,
                wireframe: showGrid,
                alphaMap: finalAlphaMap,
                alphaTest: finalAlphaMap ? (isFishnetAlpha ? 0.45 : 0.05) : 0
            };
            if (needsShader) {
                toonProps.normalMap = baseNormalForShader;
                toonProps.normalScale = new THREE.Vector2(pbrNormalScale, pbrNormalScale);
            }
            mat = new THREE.MeshToonMaterial(toonProps);
        } else {
            // ---------- 写实 ----------
            const stdProps = {
                color: textureEnabled && imageTexture ? 0xffffff : new THREE.Color(currentClothColor),
                map: textureEnabled && imageTexture ? imageTexture : null,
                side: THREE.DoubleSide,
                transparent: isTrans,
                opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
                depthWrite: depthW,
                roughness: rough,
                metalness: metal,
                wireframe: showGrid,
                flatShading: flatShadingEnabled,
                envMapIntensity: 1.0,
                alphaMap: finalAlphaMap,
                alphaTest: finalAlphaMap ? (isFishnetAlpha ? 0.45 : 0.05) : 0
            };
            if (needsShader) {
                stdProps.normalMap = baseNormalForShader;
                stdProps.normalScale = new THREE.Vector2(pbrNormalScale, pbrNormalScale);
            }
                        stdProps.transmission = clothTransmission;
            stdProps.clearcoat = clothClearcoat;
            stdProps.ior = clothIor;
            stdProps.thickness = clothThickness;
            stdProps.attenuationDistance = clothAttenuation === 0 ? Infinity : clothAttenuation;
            stdProps.attenuationColor = new THREE.Color(clothAttenuationColor);
            stdProps.iridescence = clothIridescence;
            stdProps.iridescenceIOR = clothIridescenceIor;
            stdProps.sheen = clothSheen;
            stdProps.sheenColor = new THREE.Color(clothSheenColor);
            stdProps.sheenRoughness = clothSheenRoughness;
            
            // 如果有透射，强制开启 transparent
            if (clothTransmission > 0) {
                stdProps.transparent = true;
                stdProps.depthWrite = false;
            }
            
            mat = new THREE.MeshPhysicalMaterial(stdProps);
        }
    } else {
        // ---------- 无光照（Basic）----------
        const basicProps = {
            color: textureEnabled && imageTexture ? 0xffffff : new THREE.Color(currentClothColor),
            map: textureEnabled && imageTexture ? imageTexture : null,
            side: THREE.DoubleSide,
            transparent: isTrans,
            opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
            depthWrite: depthW,
            wireframe: showGrid,
            alphaMap: finalAlphaMap,
            alphaTest: finalAlphaMap ? (isFishnetAlpha ? 0.45 : 0.05) : 0
        };
        mat = new THREE.MeshBasicMaterial(basicProps);
    }

    // ============================================================
    // 自定义 Shader 注入（PBR 法线 / 噪波 / 水珠 / 镭射 / 破洞 alpha）
    // ============================================================
    if (needsShader) {
        // dummy 法线用 1x1 repeat，避免 1px 灰图被平铺成噪点
        const repBase = (baseNormalForShader && baseNormalForShader.repeat && !useDummyNormal)
            ? baseNormalForShader.repeat.clone()
            : new THREE.Vector2(1, 1);

        mat.onBeforeCompile = (shader) => {
            activeShaderRef = shader;
            shader.uniforms.uNormalRepeat = { value: repBase };

            if (pbrAlphaTexture) {
                shader.uniforms.uAlphaRepeat = { value: pbrAlphaTexture.repeat.clone() };
            } else {
                shader.uniforms.uAlphaRepeat = { value: new THREE.Vector2(1, 1) };
            }

            if (tearTexture) {
                shader.uniforms.uTearMap = { value: tearTexture };
                shader.uniforms.uHasTearMap = { value: 1.0 };
            } else {
                shader.uniforms.uTearMap = { value: tearCanvas || document.createElement('canvas') };
                shader.uniforms.uHasTearMap = { value: 0.0 };
            }

            let noiseUniforms = "";
            let noiseLogic = "";
            if (pbrNoiseEnabled && pbrNoiseNormalTexture) {
                shader.uniforms.uNoiseMap = { value: pbrNoiseNormalTexture };
                shader.uniforms.uNoiseRepeat = { value: pbrNoiseNormalTexture.repeat.clone() };
                shader.uniforms.uNoiseIntensity = { value: pbrNoiseIntensity };
                noiseUniforms = `
                uniform sampler2D uNoiseMap;
                uniform vec2 uNoiseRepeat;
                uniform float uNoiseIntensity;
                `;
                noiseLogic = `
                vec3 noiseN = texture2D( uNoiseMap, vNormalMapUvCustom * uNoiseRepeat ).xyz * 2.0 - 1.0;
                mapN = mix(mapN, noiseN, uNoiseIntensity);
                mapN = normalize(mapN);
                `;
            }

            let waterUniforms = "";
            let waterLogic = "";
            if (waterEnabled && waterDropNormalTexture) {
                shader.uniforms.uWaterMap = { value: waterDropNormalTexture };
                shader.uniforms.uWaterRepeat = { value: new THREE.Vector2(waterRepeat, waterRepeat) };
                shader.uniforms.uWaterIntensity = { value: waterNormalIntensity };
                waterUniforms = `
                uniform sampler2D uWaterMap;
                uniform vec2 uWaterRepeat;
                uniform float uWaterIntensity;
                `;
                waterLogic = `
                vec3 waterN = texture2D( uWaterMap, vNormalMapUvCustom * uWaterRepeat ).xyz * 2.0 - 1.0;
                float waterMix = clamp(vWetness * uWaterIntensity, 0.0, 1.0);
                mapN = mix(mapN, waterN, waterMix);
                mapN = normalize(mapN);
                `;
            }

            // ---- 顶点着色器 ----
            shader.vertexShader = shader.vertexShader.replace(
                '#include <common>',
                `
                #include <common>
                varying vec2 vNormalMapUvCustom;
                attribute float wetness;
                varying float vWetness;
                `
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <uv_vertex>',
                `
                #include <uv_vertex>
                vNormalMapUvCustom = uv;
                vWetness = wetness;
                `
            );

            // ---- 片段着色器 ----
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `
                #include <common>
                varying vec2 vNormalMapUvCustom;
                varying float vWetness;
                uniform vec2 uNormalRepeat;
                uniform vec2 uAlphaRepeat;
                uniform sampler2D uTearMap;
                uniform float uHasTearMap;
                ${noiseUniforms}
                ${waterUniforms}
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <alphamap_fragment>',
                `
                #ifdef USE_ALPHAMAP
                    diffuseColor.a *= texture2D( alphaMap, vNormalMapUvCustom * uAlphaRepeat ).g;
                #endif

                if (uHasTearMap > 0.5) {
                    diffuseColor.a *= texture2D( uTearMap, vNormalMapUvCustom ).g;
                }
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `
                #ifdef USE_NORMALMAP_TANGENTSPACE
                    vec2 baseUv = vNormalMapUvCustom * uNormalRepeat;
                    vec4 normalTex = texture2D( normalMap, baseUv );
                    vec3 mapN = normalTex.xyz * 2.0 - 1.0;
                    ${noiseLogic}
                    ${waterLogic}
                    mapN.xy *= normalScale;
                    normal = normalize( tbn * mapN );
                #elif defined ( USE_NORMALMAP_OBJECTSPACE )
                    vec2 baseUv = vNormalMapUvCustom * uNormalRepeat;
                    normal = texture2D( normalMap, baseUv ).xyz * 2.0 - 1.0;
                    #if defined ( USE_NOISE_MAP )
                        vec3 noiseN = texture2D( uNoiseMap, vNormalMapUvCustom * uNoiseRepeat ).xyz * 2.0 - 1.0;
                        normal = mix(normal, noiseN, uNoiseIntensity);
                        normal = normalize(normal);
                    #endif
                #endif
                `
            );

            // ---- 镭射反光 ----
            if (holoEnabled) {
                shader.uniforms.uHoloIntensity = { value: parseFloat(holoIntensitySlider.value) };
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <common>',
                    `
                    #include <common>
                    uniform float uHoloIntensity;
                    `
                );
                shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    `
                    #include <dithering_fragment>

                    vec3 holoNormal = normalize(vNormal);
                    vec3 viewDir = normalize(vViewPosition);
                    float fresnel = pow(1.0 - abs(dot(viewDir, holoNormal)), 2.0);

                    float hue = dot(holoNormal, vec3(1.0, 1.0, 1.0)) * 1.5 + fresnel * 2.5;
                    vec3 holoColor = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + hue));

                    gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb + holoColor * fresnel, uHoloIntensity);
                    `
                );
            }
        };
    }

    mat.needsUpdate = true;
    clothMesh.material = mat;
    installBackShade(mat);          // 🪞 正反面区分（对所有材质类型都生效）
    applyDoubleSide(mat);           // 🎭 关闭背面剔除（正面永远不被剔除）
    updateClothDepthPolicy(mat);    // 🥞 开启深度遮挡（背面褶皱不透出 / 不穿模）
    clothMesh.castShadow = shadowEnabled;
    clothMesh.receiveShadow = shadowEnabled;
    if (thicknessEnabled) updateThicknessMesh();
    if (outlineEnabled) updateOutlineMesh();
}

const postVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const postFrag = `
uniform sampler2D tColor;
uniform sampler2D tVelocity;
uniform vec2 resolution;
uniform float strength;
varying vec2 vUv;
const int SAMPLES = 12;
void main() {
  vec4 centerColor = texture2D(tColor, vUv);
  vec3 finalColor = centerColor.rgb;
  float finalAlpha = centerColor.a;
  vec2 encodedVel = texture2D(tVelocity, vUv).rg;
  vec2 vel = (encodedVel - 0.5) * 2.0;
  float speed = length(vel);
  if (speed > 0.0001 && strength > 0.001) {
    vec2 pxVel = vel * resolution;
    float pxSpeed = length(pxVel);
    float pxLen = pxSpeed * strength * 6.0;
    if (pxLen > 0.5) {
      pxLen = min(pxLen, 80.0);
      vec2 dir = pxVel / max(pxSpeed, 1e-5);
      float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      vec4 sumColor = vec4(0.0);
      float totalWeight = 0.0;
      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1) - 0.5 + jitter * (1.0 / float(SAMPLES));
        vec2 uvOffset = dir * (t * pxLen) / resolution;
        vec4 sampleColor = texture2D(tColor, vUv + uvOffset);
        float weight = 1.0 - abs(t * 2.0);
        sumColor += sampleColor * weight;
        totalWeight += weight;
      }
      if (totalWeight > 0.0) {
        vec4 blurred = sumColor / totalWeight;
        finalColor = blurred.rgb;
        finalAlpha = blurred.a;
      }
    }
  }
  finalColor = pow(max(finalColor, vec3(0.0)), vec3(1.0 / 2.2));
  gl_FragColor = vec4(finalColor, finalAlpha);
}
`;

function createVelocityMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {},
        vertexShader: `
      attribute vec3 prevPosition;
      varying vec2 vVelocity;
      void main() {
        vec4 clipCur  = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec4 clipPrev = projectionMatrix * modelViewMatrix * vec4(prevPosition, 1.0);
        vec2 ndcCur  = clipCur.xy  / clipCur.w;
        vec2 ndcPrev = clipPrev.xy / clipPrev.w;
        vVelocity = (ndcCur - ndcPrev) * 0.5;
        gl_Position = clipCur;
      }
    `,
        fragmentShader: `
      varying vec2 vVelocity;
      void main() {
        gl_FragColor = vec4(vVelocity * 0.5 + 0.5, 0.0, 1.0);
      }
    `,
        side: THREE.DoubleSide
    });
}

function initBlur() {
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postScene = new THREE.Scene();
    postMat = new THREE.ShaderMaterial({
        uniforms: {
            tColor:     { value: null },
            tVelocity:  { value: null },
            resolution: { value: new THREE.Vector2(1, 1) },
            strength:   { value: blurStrength }
        },
        vertexShader: postVert,
        fragmentShader: postFrag,
        depthTest: false,
        depthWrite: false,
        transparent: true
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
    quad.frustumCulled = false;
    postScene.add(quad);

    velocityScene = new THREE.Scene();
    velocityMat = createVelocityMaterial();
}

function ensureBlurTargets(w, h) {
    if (!renderer) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    if (rtScene && rtScene.width === pw && rtScene.height === ph) {
        if (postMat) postMat.uniforms.resolution.value.set(pw, ph);
        return;
    }
    if (rtScene) rtScene.dispose();
    if (rtVelocity) rtVelocity.dispose();

    const sceneOpts = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false
    };
    rtScene = new THREE.WebGLRenderTarget(pw, ph, sceneOpts);
    if ('colorSpace' in rtScene.texture) {
        rtScene.texture.colorSpace = THREE.LinearSRGBColorSpace;
    } else if ('encoding' in rtScene.texture) {
        rtScene.texture.encoding = THREE.LinearEncoding;
    }
    const isWebGL2 = !!(renderer.capabilities && renderer.capabilities.isWebGL2);
    rtVelocity = new THREE.WebGLRenderTarget(pw, ph, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false
    });
    postMat.uniforms.resolution.value.set(pw, ph);
    blurNeedsReset = true;
}

function renderBlurFrame(skipVelocity) {
    const savedColor = renderer.getClearColor(new THREE.Color());
    const savedAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    if (!skipVelocity && velocityMesh && velocityMesh.geometry && velocityMesh.geometry.attributes.prevPosition) {
        let clearCol;
        if (THREE.ColorManagement && THREE.LinearSRGBColorSpace) {
            clearCol = new THREE.Color().setRGB(0.5, 0.5, 0.5, THREE.LinearSRGBColorSpace);
        } else {
            clearCol = new THREE.Color(0.5, 0.5, 0.5);
        }
        renderer.setClearColor(clearCol, 1);

        renderer.setRenderTarget(rtVelocity);
        renderer.clear();
        renderer.render(velocityScene, camera);
    }

    postMat.uniforms.tColor.value = rtScene.texture;
    postMat.uniforms.tVelocity.value = rtVelocity.texture;
    // 跳过 velocity pass 时，rtVelocity 里还是上一帧（旧视角）的假速度，
    // 所以必须把强度归零，否则照样会沿那条假速度拖影
    postMat.uniforms.strength.value = skipVelocity ? 0 : blurStrength;

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(postScene, postCamera);

    renderer.setClearColor(savedColor, savedAlpha);
}

// ==============================================================
// 🎥 3D 镜头：旋转场景 holder（正交相机本身不动，避免破坏世界坐标逻辑）
//   PC：右键拖动转镜头，Shift+右键平移，滚轮推拉
//   手机：屏幕方向按钮
// ==============================================================
let cam3DPitch = 0;      // 俯仰（度）
let cam3DYaw = 0;        // 环绕（度）
let cam3DPanX = 0;
let cam3DPanY = 0;
let cam3DZoom = 1;       // 推拉倍数
// 镜头刚动过的守护时间（毫秒）：这段时间内不做动态模糊，
// 因为速度缓冲里的 prevPosition 还停留在旧视角之下，算出来的速度是假的
let cameraMovedUntil = 0;
let cam3DEnabled = false;
// 🎥 手机拖动镜头时的上一个触点
let cam3DTouchLast = null;
// 俯仰上限（度）：弱透视展示视角，禁止夸张的仰视/俯视
const CAM3D_PITCH_LIMIT = 40;

// 🧷 解算时可移动固定点 → 用彩色小圆点标出它们的位置
let pinDotsMesh = null;
let pinDotsGeo = null;

// 🟫 地面显示开关：默认关（和你现在看到的一致），打开后在布料下方显示柔色地板
// 并接收阴影，给模型一个"地面"参考（3D 视角里尤其需要）
let groundVisible = false;

/** 按开关 / 地面高度同步地面两层（地板 + 阴影层） */
function updateGroundDisplay() {
    const y = Number.isFinite(groundY) ? groundY : -1.5;
    if (groundMesh) {
        groundMesh.visible = groundVisible;
        groundMesh.position.y = y;
    }
    if (groundShadowMesh) {
        groundShadowMesh.visible = groundVisible && !!shadowEnabled;
        groundShadowMesh.position.y = y + 0.01;
    }
}

function updatePinDots() {
    if (!scene) return;
    const show = pinDragEnabled && !editMode && cloth && cloth.particles && hasGeneratedOnce;
    if (!show) {
        if (pinDotsMesh) pinDotsMesh.visible = false;
        return;
    }
    const pins = [];
    for (const p of cloth.particles) {
        if (p.pinned) pins.push(p);
    }
    if (pins.length === 0) {
        if (pinDotsMesh) pinDotsMesh.visible = false;
        return;
    }

    if (!pinDotsMesh) {
        pinDotsGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(pins.length * 3);
        pinDotsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const dotTex = makePinDotTexture();
        const dotMat = new THREE.PointsMaterial({
            // 正交相机下 sizeAttenuation 会把点缩成 0.055 像素（等于看不见），所以按像素给
            size: 13,
            map: dotTex,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            sizeAttenuation: false,
            alphaTest: 0.01
        });
        pinDotsMesh = new THREE.Points(pinDotsGeo, dotMat);
        pinDotsMesh.renderOrder = 999;
        pinDotsMesh.frustumCulled = false;
        (sceneHolder || scene).add(pinDotsMesh);
    }

    const attr = pinDotsGeo.attributes.position;
    const need = pins.length * 3;
    if (attr.array.length < need) {
        pinDotsGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(need), 3));
    }
    const arr = pinDotsGeo.attributes.position.array;
    for (let i = 0; i < pins.length; i++) {
        arr[i * 3] = pins[i].x;
        arr[i * 3 + 1] = pins[i].y;
        arr[i * 3 + 2] = pins[i].z + 0.01;
    }
    pinDotsGeo.attributes.position.needsUpdate = true;
    pinDotsGeo.setDrawRange(0, pins.length);
    pinDotsMesh.visible = true;
    // 圆点像素大小随 DPR 调整，保证高分屏也看得清
    if (pinDotsMesh.material) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        pinDotsMesh.material.size = Math.max(9, Math.round(13 * dpr / 2));
    }
    // 3D 镜头转动时圆点也跟着场景转（本身已在 holder 内）

}

// 固定点小圆点贴图（粉色描边 + 白心 + 柔和光晕）
let pinDotTextureCache = null;
function makePinDotTexture() {
    if (pinDotTextureCache) return pinDotTextureCache;
    const s = 64;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.32, "rgba(255,140,176,1)");
    grad.addColorStop(0.55, "rgba(255,110,158,0.85)");
    grad.addColorStop(0.78, "rgba(255,120,165,0.28)");
    grad.addColorStop(1, "rgba(255,120,165,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    const tex = new THREE.CanvasTexture(c);
    pinDotTextureCache = tex;
    return tex;
}

function applyCamera3D() {
    if (!sceneHolder) return;
    const pitchRad = cam3DPitch * Math.PI / 180;
    const yawRad = cam3DYaw * Math.PI / 180;
    sceneHolder.rotation.set(pitchRad, yawRad, 0, "XYZ");
    sceneHolder.position.set(cam3DPanX, cam3DPanY, 0);
    sceneHolder.scale.setScalar(cam3DZoom);
    if (cloth) cloth._forceNormals = true;
    // 🎯 镜头一动，速度缓冲里的"上一帧位置"就作废了：
    // 那个速度缓冲是用**同一个模型矩阵**分别变换 position / prevPosition 得到的，
    // 只对"布料自己动"有效；一旦 holder 的矩阵变了，两种采样就落在不同坐标系里，
    // 算出一个巨大的假速度 → 动态模糊沿这个方向狂拖，画面就是"硬折痕 / 贴图撕裂"，
    // 停止转动后 prev == position → 速度归零 → 画面又恢复正常。与用户描述完全一致。
    cameraMovedUntil = performance.now() + 150;
    resetVelocityBuffer();
    updateCamera3DLabels();
    drawAxisGizmo();
}

// ==========================================================
// 🧭 坐标轴方位罗盘
// ----------------------------------------------------------
// 相机本身不动，是 sceneHolder 在转。所以罗盘只要把世界坐标轴用当前的
// 俯仰/环绕变换一次，再正交投到屏幕平面即可（X 红 / Y 绿 / Z 蓝，与 Blender 一致）。
// 纯 2D canvas 绘制，不额外开渲染 pass，3D 镜头关闭时整个隐藏。
// ==========================================================
const AXIS_GIZMO_COLORS = {
    x: "#E5533D",      // 红
    y: "#7CB342",      // 绿
    z: "#3B82F6",      // 蓝
    xNeg: "#F2A79A",
    yNeg: "#B5D98A",
    zNeg: "#9FC5F8"
};

function drawAxisGizmo() {
    const wrap = document.getElementById("axisGizmoWrap");
    const cv = document.getElementById("axisGizmo");
    if (!wrap || !cv) return;
    const show = cam3DEnabled && !editMode;
    wrap.style.display = show ? "block" : "none";
    if (!show) return;

    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    ctx.clearRect(0, 0, W, H);

    const pitch = cam3DPitch * Math.PI / 180;
    const yaw = cam3DYaw * Math.PI / 180;
    // 与 sceneHolder.rotation.set(pitch, yaw, 0, "XYZ") 等价的旋转：
    // 先绕 Y（环绕），再绕 X（俯仰）
    const project = (vx, vy, vz) => {
        const c1 = Math.cos(yaw), s1 = Math.sin(yaw);
        let x1 = c1 * vx + s1 * vz;
        let y1 = vy;
        let z1 = -s1 * vx + c1 * vz;
        const c2 = Math.cos(pitch), s2 = Math.sin(pitch);
        const y2 = c2 * y1 - s2 * z1;
        const z2 = s2 * y1 + c2 * z1;
        // 相机沿 -Z 看：屏幕 x = 世界 x，屏幕 y = 世界 y（y 向上，canvas y 向下）
        return { sx: cx + x1 * R, sy: cy - y2 * R, depth: z2 };
    };

    const axes = [
        { key: "x", v: [1, 0, 0], label: "X" },
        { key: "y", v: [0, 1, 0], label: "Y" },
        { key: "z", v: [0, 0, 1], label: "Z" }
    ];
    const items = [];
    for (const a of axes) {
        const pos = project(a.v[0], a.v[1], a.v[2]);
        const neg = project(-a.v[0], -a.v[1], -a.v[2]);
        items.push({ ...a, pos, neg, kind: "pos" });
    }
    // 深度小的（更靠前）后画，保证近的盖住远的
    items.sort((p, q) => q.pos.depth - p.pos.depth);

    const drawAxis = (from, to, color, alpha, withLabel, label, dim) => {
        const dx = to.sx - from.sx, dy = to.sy - from.sy;
        const len = Math.hypot(dx, dy);
        if (len < 0.6) return;
        const ux = dx / len, uy = dy / len;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = dim ? 1.6 : 2.4;
        ctx.beginPath();
        ctx.moveTo(from.sx, from.sy);
        ctx.lineTo(to.sx, to.sy);
        ctx.stroke();
        // 箭头
        if (withLabel) {
            const ah = dim ? 5 : 7;
            ctx.beginPath();
            ctx.moveTo(to.sx, to.sy);
            ctx.lineTo(to.sx - ux * ah - uy * ah * 0.55, to.sy - uy * ah + ux * ah * 0.55);
            ctx.lineTo(to.sx - ux * ah + uy * ah * 0.55, to.sy - uy * ah - ux * ah * 0.55);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            // 轴名
            ctx.globalAlpha = 1;
            ctx.fillStyle = color;
            ctx.font = "bold 12px system-ui, -apple-system, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, to.sx + ux * 9, to.sy + uy * 9);
        }
        ctx.globalAlpha = 1;
    };

    const origin = { sx: cx, sy: cy };
    for (const it of items) {
        // 负方向先画（细、淡），正方向后画（粗、带轴名）
        drawAxis(origin, it.neg, AXIS_GIZMO_COLORS[it.key + "Neg"], 0.75, false, "", true);
    }
    for (const it of items) {
        drawAxis(origin, it.pos, AXIS_GIZMO_COLORS[it.key], 1, true, it.label, false);
    }
    // 原点小球
    ctx.fillStyle = "#8A8F98";
    ctx.beginPath();
    ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
    ctx.fill();
}

/** 把速度缓冲归零（prevPosition := position），并标记本帧末需要重新同步 */
function resetVelocityBuffer() {
    if (!cloth || !cloth.geometry) return;
    const pos = cloth.geometry.attributes.position;
    const prev = cloth.geometry.attributes.prevPosition;
    if (!pos || !prev) return;
    prev.array.set(pos.array);
    prev.needsUpdate = true;
}

function updateCamera3DLabels() {
    const pEl = document.getElementById("cam3DPitchValue");
    const yEl = document.getElementById("cam3DYawValue");
    const zEl = document.getElementById("cam3DZoomValue");
    if (pEl) pEl.textContent = Math.round(cam3DPitch) + "°";
    if (yEl) yEl.textContent = Math.round(cam3DYaw) + "°";
    if (zEl) zEl.textContent = cam3DZoom.toFixed(2);
}

function resetCamera3D() {
    cam3DPitch = 0; cam3DYaw = 0; cam3DPanX = 0; cam3DPanY = 0; cam3DZoom = 1;
    applyCamera3D();}

function bindCamera3DControls() {
    const host = document.querySelector(".canvasWrap");
    if (!host) return;

    let dragging = false, lastX = 0, lastY = 0, wantPan = false;

    host.addEventListener("mousedown", (e) => {
        if (!cam3DEnabled || e.button !== 2) return;
        dragging = true; wantPan = e.shiftKey;
        lastX = e.clientX; lastY = e.clientY;
        e.preventDefault(); e.stopPropagation();
    }, true);

    window.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        if (wantPan) {
            // 平移按缩放比例换算，保证"鼠标拖多少、画面跟多少"，并把平移限制在合理范围
            const k = 0.01 / Math.max(0.35, cam3DZoom);
            cam3DPanX = Math.max(-2.5, Math.min(2.5, cam3DPanX + dx * k));
            cam3DPanY = Math.max(-2.5, Math.min(2.5, cam3DPanY - dy * k));
        } else {
            cam3DYaw = Math.max(-180, Math.min(180, cam3DYaw - dx * 0.35));
            // 🎥 俯仰夹在 ±40°：弱透视正面展示，不做夸张的仰视/俯视
            cam3DPitch = Math.max(-CAM3D_PITCH_LIMIT, Math.min(CAM3D_PITCH_LIMIT, cam3DPitch - dy * 0.28));
        }
        applyCamera3D();
        e.preventDefault();
    }, true);

    window.addEventListener("mouseup", (e) => {
        if (e.button === 2 && dragging) { dragging = false; e.preventDefault(); }
    }, true);

    // ---- 手机方向按钮（长按连续转动）----
    const step = 8;
    const PITCH_LIMIT = CAM3D_PITCH_LIMIT;
    const actions = {
        cam3DLeft:  () => { cam3DYaw = Math.max(-180, cam3DYaw - step); },
        cam3DRight: () => { cam3DYaw = Math.min(180, cam3DYaw + step); },
        cam3DUp:    () => { cam3DPitch = Math.min(PITCH_LIMIT, cam3DPitch + step); },
        cam3DDown:  () => { cam3DPitch = Math.max(-PITCH_LIMIT, cam3DPitch - step); },
        cam3DIn:    () => { cam3DZoom = Math.min(2.5, cam3DZoom * 1.10); },
        cam3DOut:   () => { cam3DZoom = Math.max(0.35, cam3DZoom * 0.90); }
    };
    for (const [id, fn] of Object.entries(actions)) {
        const el = document.getElementById(id);
        if (!el) continue;
        let holdTimer = null;
        const fire = () => { fn(); applyCamera3D(); };
        el.addEventListener("click", (ev) => { ev.preventDefault(); if (!cam3DEnabled) return; fire(); });
        el.addEventListener("pointerdown", (ev) => {
            ev.preventDefault();
            if (!cam3DEnabled) return;
            holdTimer = setInterval(fire, 90);
        });
        const stop = () => { if (holdTimer) { clearInterval(holdTimer); holdTimer = null; } };
        el.addEventListener("pointerup", stop);
        el.addEventListener("pointerleave", stop);
        el.addEventListener("pointercancel", stop);
    }

    const toggle = document.getElementById("toggleCam3D");
    if (toggle) {
        toggle.onchange = () => {
            cam3DEnabled = toggle.checked;
            // 关闭时不复位：镜头姿态保留，想回正按「复位」按钮
            if (cam3DEnabled && typeof pinDragEnabled === "boolean" && pinDragEnabled) {
                // 3D 镜头打开时自动关掉固定点拖动，避免拖拽/旋转抢手势
                pinDragEnabled = false;
                const pinToggle = document.getElementById("togglePinDrag");
                if (pinToggle) pinToggle.checked = false;
                draggingPins = false;
                draggedParticles = [];
            }
            // 🧭 罗盘跟随开关显示/隐藏
            drawAxisGizmo();
        };
    }

    const resetBtn = document.getElementById("cam3DReset");
    if (resetBtn) resetBtn.onclick = () => resetCamera3D();
}

function initThree() {
    scene = new THREE.Scene();
    scene.background = null;
    updateEnvironment();

    // 🎥 弱透视相机（窄 fov + 远距离）：接近正交，但保留一点点立体感，
    //    避免游戏那种夸张近大远小；具体焦距/距离在 updateCamera() 里按画布比例换算。
    camera = new THREE.PerspectiveCamera(WEAK_FOV_DEG, CANVAS_W / Math.max(1, CANVAS_H), 0.05, 400);
    camera.position.set(0, 0, 9);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowSpecMode ? 1 : 2));
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if ('outputColorSpace' in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ('outputEncoding' in renderer) {
        renderer.outputEncoding = THREE.sRGBEncoding;
    }

    document.getElementById("threeContainer").appendChild(renderer.domElement);

    // 🎥 3D 镜头：布料/装饰/地面/背景墙都挂到这个 holder 上，转动镜头时整体旋转
    sceneHolder = new THREE.Group();
    scene.add(sceneHolder);

    const groundGeo = new THREE.PlaneGeometry(20, 20);
    // 🟫 可见的地面：ShadowMaterial 只在"有阴影时"可见，平时整块透明 —— 用户看不到地面。
    // 这里改成可见的柔色地板（接收阴影），再叠一层只负责阴影的 ShadowMaterial，
    // 这样既有"地平线"参考，又能看清布料投下的影子。
    const groundBaseMat = new THREE.MeshBasicMaterial({
        color: 0xF3F4F6,
        transparent: true,
        opacity: 0.96,
        depthWrite: true,
        side: THREE.DoubleSide
    });
    groundMesh = new THREE.Mesh(groundGeo, groundBaseMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -1.5;
    groundMesh.receiveShadow = true;
    groundMesh.visible = false;
    sceneHolder.add(groundMesh);

    // 阴影层（略高于地板，避免与地板深度打架）
    const groundShadowMat = new THREE.ShadowMaterial({ opacity: 0.28, transparent: true, depthWrite: false });
    groundShadowMesh = new THREE.Mesh(groundGeo, groundShadowMat);
    groundShadowMesh.rotation.x = -Math.PI / 2;
    groundShadowMesh.position.y = -1.49;
    groundShadowMesh.receiveShadow = true;
    groundShadowMesh.visible = false;
    groundShadowMesh.renderOrder = 2;
    sceneHolder.add(groundShadowMesh);

    const wallGeo = new THREE.PlaneGeometry(30, 30);
    const wallMat = new THREE.ShadowMaterial({
        color: 0x5A5A7A,
        opacity: 0.32,
        transparent: true,
        depthWrite: false
    });
    backWallMesh = new THREE.Mesh(wallGeo, wallMat);
    backWallMesh.position.set(0, 1.2, -2.6);
    backWallMesh.receiveShadow = true;
    backWallMesh.visible = false;
    sceneHolder.add(backWallMesh);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    if (typeof bindCamera3DControls === "function") bindCamera3DControls();
}

function resizeCanvas() {
    const w = Math.max(1, canvasHost.clientWidth);
    const h = Math.max(1, canvasHost.clientHeight);
    // 🪶 低配模式最高 1 倍像素比：渲染像素直接降到 1/4，核显/手机上提升最明显
    const dpr = Math.min(window.devicePixelRatio || 1, lowSpecMode ? 1 : 2);

    CANVAS_W = w; CANVAS_H = h;

    previewCanvas.width = Math.floor(w * dpr);
    previewCanvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (renderer) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        ensureBlurTargets(w, h);
    }
    updateCamera();
    redrawPreview();
}

// ============================================================
// Tooltip 自动注入：给每个设置项的 label 后追加「?」提示按钮
// ============================================================
function injectTooltips() {
    // 控件 ID → i18n 描述 key（映射表可自由扩展）
    const tooltipMap = {
        // ---- 基础操作 ----
        "pinRadius":            "pin_radius_desc",
        "decorSizeSlider":      "decor_size_desc",
        "selDecorSize":         "decor_size_desc",
        "selDecorColor":        "decor_color_desc",
        "decorTypeSelect":      "decor_type_desc",
        "decorMatSelect":       "decor_mat_desc",
        "decorWeightSelect":    "decor_weight_desc",
        "selDecorType":         "decor_type_desc",
        "selDecorMat":          "decor_mat_desc",
        "selDecorWeight":       "decor_weight_desc",

        // ---- 材质与滤镜 ----
        "clothColor":           "base_color_desc",
        "materialPreset":       "mat_preset_desc",
        "pbrTextureSelect":     "pbr_tex_desc",
        "textureFilterSelect":  "tex_filter_desc",
        "filterStrength":       "tex_filter_strength_desc",
        "pbrTextureSize":       "pbr_tex_size_desc",
        "pbrNormalScale":       "pbr_normal_scale_desc",
        "pbrNoiseStyle":        "pbr_noise_style_desc",
        "pbrNoiseIntensity":    "pbr_noise_intensity_desc",
        "pbrNoiseSize":         "pbr_noise_size_desc",

        // ---- 物理基础 ----
        "physicsPreset":        "preset_title_desc",
        "stiffness":            "stiff_desc",
        "maxStretch":           "max_stretch_desc",
        "damping":              "damp_desc",
        "gravity":              "gravity_desc",
        "mass":                 "mass_desc",
        "simMult":              "sim_mult_desc",
        "meshRes":              "mesh_res_desc",
        "constraintIterations": "constraint_iterations_desc",
        "physicsHz":            "physics_hz_desc",
        "collisionRadius":      "collision_radius_desc",
        "collisionForce":       "collision_force_desc",
        "collisionIters":       "collision_iters_desc",
        "collisionQuality":     "collision_quality_desc",

        // ---- 风力 ----
        "wind":                 "wind_strength_desc",
        "windDir":              "wind_dir_desc",
        "windNoiseAmp":         "wind_noise_amp_desc",
        "windRandom":           "wind_random_desc",
        "windSpeed":            "wind_speed_desc",

        // ---- 塑性形变（新） ----
        "plasticityRate":       "plasticity_rate_desc",
        "plasticityThreshold":  "plasticity_threshold_desc",
        "plasticityRecovery":   "plasticity_recovery_desc",
        "plasticityMax":        "plasticity_max_desc",

        // ---- 弹簧高级（新） ----
        "bendStiffness":        "bend_stiffness_desc",
        "shearStiffness":       "shear_stiffness_desc",
        "stiffX":               "stiff_x_desc",
        "stiffY":               "stiff_y_desc",
        "springDamping":        "spring_damping_desc",

        // ---- 风力高级（新） ----
        "windSpatialFreq":      "wind_spatial_freq_desc",
        "windZ":                "wind_z_desc",

        // ---- 重力与地面（新） ----
        "gravityAngle":         "gravity_angle_desc",
        "groundY":              "ground_y_desc",
        "groundFriction":       "ground_friction_desc",

        // ---- 其他高级（新） ----
        "collisionFriction":    "collision_friction_desc",
        "dragStrength":         "drag_strength_desc",
        "airDampingExp":        "air_damping_exp_desc",
        "maxVelocity":          "max_velocity_desc",
        "velocityRetention":    "velocity_retention_desc",

        // ---- 光影 ----
        "lightIntensity":       "light_intensity_desc",
        "lightColor":           "light_color_desc",
        "roughness":            "roughness_desc",
        "metalness":            "metalness_desc",
        "opacity":              "opacity_desc",
        "lightStyle":           "light_style_desc",
        "toonSteps":            "toon_steps_desc",
        "holoIntensity":        "fx_holo_intensity_desc",
        "lightX":               "light_x_desc",
        "lightY":               "light_y_desc",
        "lightZ":               "light_z_desc",

        // ---- 编辑与拖拽 ----
        "dragRadius":           "grab_radius_desc",
        "knifeRadius":          "knife_radius_desc",
        "maxDragDistance":      "max_drag_dist_desc",
        "tearThreshold":        "tear_threshold_desc",
        "dragDepthSelect":      "drag_depth_desc",
        "rotXSlider":           "cloth_rotate_x_desc",
        "rotYSlider":           "cloth_rotate_y_desc",
        "rotZSlider":           "cloth_rotate_z_desc",

        // ---- 渲染特效 ----
        "blurStrength":         "blur_strength_desc",
        "thicknessSize":        "th_size_desc",
        "thicknessColor":       "th_color_desc",
        "outlineThick":         "out_thick_desc",
        "outlineColor":         "out_color_desc",

        // ---- 泼水 ----
        "evapSpeed":            "evap_speed_desc",
        "waterDropSize":        "water_drop_size_desc",
        "waterDropDensity":     "water_drop_density_desc",
        "waterNormalIntensity": "water_normal_intensity_desc",

        // ---- 背景与相机 ----
        "bgColor":              "bg_color_desc",
        "bgScale":              "bg_scale_desc",
        "bgX":                  "bg_x_desc",
        "bgY":                  "bg_y_desc",
        "zoom":                 "cam_zoom_desc",
        "camX":                 "cam_left_desc",
        "camY":                 "cam_up_desc",

                // ---- 高级物理材质（新） ----
        "matTransmission":      "mat_transmission_desc",
        "matClearcoat":         "mat_clearcoat_desc",
        "matIor":               "mat_ior_desc",
        "matThickness":         "mat_thickness_desc",
        "matAttenuation":       "mat_attenuation_desc",
        "matAttenuationColor":  "mat_attenuation_color_desc",
        "matIridescence":       "mat_iridescence_desc",
        "matIridescenceIor":    "mat_iridescence_ior_desc",
        "matSheen":             "mat_sheen_desc",
        "matSheenColor":        "mat_sheen_color_desc",
        "matSheenRoughness":    "mat_sheen_roughness_desc",
    };

    // 开关说明：给带 data-tip 的 .toggle-label 注入「?」提示（复用同一套 tooltip）
    document.querySelectorAll('.toggle-label[data-tip]').forEach(label => {
        if (label.querySelector('.tooltip-wrap')) return;
        const descKey = label.getAttribute('data-tip');
        if (!descKey) return;
        if (label.hasAttribute('data-i18n')) {
            const key = label.getAttribute('data-i18n');
            label.removeAttribute('data-i18n');
            const span = document.createElement('span');
            span.setAttribute('data-i18n', key);
            span.innerHTML = label.innerHTML;
            label.innerHTML = '';
            label.appendChild(span);
        }
        const tip = document.createElement('span');
        tip.className = 'tooltip-wrap';
        tip.innerHTML = `<i class="fa-solid fa-circle-question"></i><span class="tooltip-text" data-i18n="${descKey}"></span>`;
        label.appendChild(tip);
    });

    document.querySelectorAll('.ctrl label').forEach(label => {
        // 已有 tooltip 就跳过（防重复注入）
        if (label.querySelector('.tooltip-wrap')) return;

        // 找关联控件 ID：优先 for 属性，其次同 .ctrl 里第一个 input/select
        let controlId = label.getAttribute('for');
        if (!controlId) {
            const ctrl = label.closest('.ctrl');
            if (ctrl) {
                const el = ctrl.querySelector('input[id], select[id]');
                if (el) controlId = el.id;
            }
        }
        if (!controlId) return;

        const descKey = tooltipMap[controlId];
        if (!descKey) return;

        // 若 label 自身带 data-i18n，先把内容包成 span，避免后续语言切换覆盖掉 tooltip
        if (label.hasAttribute('data-i18n')) {
            const key = label.getAttribute('data-i18n');
            label.removeAttribute('data-i18n');
            const span = document.createElement('span');
            span.setAttribute('data-i18n', key);
            span.innerHTML = label.innerHTML;
            label.innerHTML = '';
            label.appendChild(span);
        }

        // 追加「?」提示按钮（复用全局 tooltip 系统）
        const tip = document.createElement('span');
        tip.className = 'tooltip-wrap';
        tip.innerHTML = `<i class="fa-solid fa-circle-question"></i><span class="tooltip-text" data-i18n="${descKey}"></span>`;
        label.appendChild(tip);
    });

    // 填充 tooltip 文本
    if (window.updateLanguage) {
        
        window.updateLanguage(window.currentLang || 'zh');
    }
}

function getPointerClient(e) {
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

function getPreviewPointer(e) {
    if (!loadedImage) return { x: 0, y: 0 };
    const rect = canvasHost.getBoundingClientRect();
    const { x: cx, y: cy } = getPointerClient(e);

    const imgW = loadedImage.width, imgH = loadedImage.height;
    const scale = Math.min(rect.width / imgW, rect.height / imgH);
    const dw = imgW * scale, dh = imgH * scale;
    const dx = (rect.width - dw) / 2, dy = (rect.height - dh) / 2;

    let u = (cx - rect.left - dx) / dw;
    let v = (cy - rect.top - dy) / dh;

    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    let maxW = BOUND_SCALE * 2 * 0.95;
    let maxH = maxW;
    if (imgAspect >= 1) {
        maxH = maxW / imgAspect;
    } else {
        maxW = maxH * imgAspect;
    }

    let x = u * maxW - maxW / 2;
    let y = maxH / 2 - v * maxH;

    if (flipH) x = -x;
    if (flipV) y = -y;
    return { x, y };
}

function getNDCFromClient(cx, cy) {
    const rect = canvasHost.getBoundingClientRect();
    return new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
}

function getNDC(e) {
    const { x: cx, y: cy } = getPointerClient(e);
    return getNDCFromClient(cx, cy);
}

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
// 复用的逆矩阵缓冲（避免每次拖拽分配新 Matrix4）
const _holderInv = new THREE.Matrix4();

// ⌨️ 1~8 快捷键：依次套用 上边整条/2点/3点/5点/四角/全框/左右两点/恢复默认
const QUICK_PIN_KEYS = {
    "1": "top", "2": "top2", "3": "top3", "4": "top5",
    "5": "corners", "6": "frame", "7": "sides", "8": "clear"
};

window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
    const key = QUICK_PIN_KEYS[e.key];
    if (!key) return;
    const btn = document.querySelector('.quick-pin-btn[data-quickpin="' + key + '"]');
    if (btn) { btn.click(); e.preventDefault(); }
});

// 🧷 解算时拖动固定点：命中固定点则返回 true（改变固定点间距，布料实时跟随）
function tryStartPinDrag(e) {
    if (!pinDragEnabled || !clothMesh || !cloth) return false;

    raycaster.setFromCamera(getNDC(e), camera);
    const hits = raycaster.intersectObject(clothMesh, true);
    const hitPoint = new THREE.Vector3();
    if (hits.length > 0) {
        hitPoint.copy(hits[0].point);
    } else {
        const plane = new THREE.Plane(getDragPlaneNormal(new THREE.Vector3()), 0);
        if (!raycaster.ray.intersectPlane(plane, hitPoint)) return false;
    }
    // 世界坐标 → holder 局部坐标（镜头转过之后两者不同，不转换会拖偏）
    if (sceneHolder) hitPoint.applyMatrix4(new THREE.Matrix4().copy(sceneHolder.matrixWorld).invert());

    const grabR = parseFloat(dragRadiusSlider.value) || 0.2;
    const grabR2 = (grabR * 1.4) * (grabR * 1.4);
    let nearestPin = -1, bestD = grabR2;
    for (let i = 0; i < cloth.particles.length; i++) {
        const p = cloth.particles[i];
        if (!p.pinned) continue;
        const d2 = (p.x - hitPoint.x) ** 2 + (p.y - hitPoint.y) ** 2 + (p.z - hitPoint.z) ** 2;
        if (d2 < bestD) { bestD = d2; nearestPin = i; }
    }
    if (nearestPin < 0) return false;

    // 🧷 拖动整片固定区：把「连成一片的所有固定点」一起搬（不是只搬抓取半径内的）
    const anchorP = cloth.particles[nearestPin];
    draggedParticles = [];

    // 整片判定：按【网格连通】找同一片固定点（相邻格 ix/iy 差 ≤ 1 即相连）
    // 这样无论抓哪儿，整条/整框/整片固定点都会一起被搬走，不会留下没跟上的点
    const pinSet = new Set();
    const byGrid = new Map();   // "ix,iy" → particle index
    for (let i = 0; i < cloth.particles.length; i++) {
        const p = cloth.particles[i];
        if (!p.pinned) continue;
        pinSet.add(i);
        byGrid.set(p.ix + "," + p.iy, i);
    }
    const cluster = new Set();
    const queue = [nearestPin];
    while (queue.length) {
        const idx = queue.pop();
        if (cluster.has(idx) || !pinSet.has(idx)) continue;
        cluster.add(idx);
        const p = cloth.particles[idx];
        // 8 邻域（含对角）有固定点就算连在一起
        for (let ddx = -1; ddx <= 1; ddx++) {
            for (let ddy = -1; ddy <= 1; ddy++) {
                if (ddx === 0 && ddy === 0) continue;
                const ni = byGrid.get((p.ix + ddx) + "," + (p.iy + ddy));
                if (ni !== undefined && !cluster.has(ni)) queue.push(ni);
            }
        }
    }

    for (const idx of cluster) {
        const p = cloth.particles[idx];
        draggedParticles.push({
            index: idx,
            ox: p.x - hitPoint.x,
            oy: p.y - hitPoint.y,
            oz: p.z - hitPoint.z
        });
    }
    if (!draggedParticles.length) return false;

    draggingPins = true;
    dragOrigin.copy(hitPoint);
    dragPlane.setFromNormalAndCoplanarPoint(getDragPlaneNormal(new THREE.Vector3()), hitPoint);
    return true;
}

// 3D 镜头旋转后，拖拽用的平面要与布料所在平面一致
function getDragPlaneNormal(out) {
    out.set(0, 0, 1);
    if (sceneHolder) out.applyQuaternion(sceneHolder.quaternion);
    return out;
}

function tryStartDrag(e) {
    if (!isSimulating) return false;
    if (!clothMesh || !cloth) return false;

    raycaster.setFromCamera(getNDC(e), camera);
    const hits = raycaster.intersectObject(clothMesh, true);

    let hitPoint = new THREE.Vector3();

    if (hits.length > 0) {
        hitPoint.copy(hits[0].point);
    } else {
        const plane = new THREE.Plane(getDragPlaneNormal(new THREE.Vector3()), 0);
        const intersectRes = raycaster.ray.intersectPlane(plane, hitPoint);
        if (!intersectRes) return false;
    }
    // 🎯 关键修复：命中点必须换算回 holder 的局部坐标！
    // hits[0].point 是**世界坐标**，而 cloth.particles 存的是 holder 局部坐标。
    // 3D 镜头转过之后两个坐标系不再重合，直接比距离就会整体镜像/旋转，
    // 表现正是"点右侧却选中了左侧的顶点"。其它拖拽入口都做了这个逆变换，只有这里漏了。
    if (sceneHolder) hitPoint.applyMatrix4(_holderInv.copy(sceneHolder.matrixWorld).invert());

    draggedParticles = [];
    draggingPins = false;
    dragOrigin.copy(hitPoint);


    if (dragMode === "single") {
        let nearest = -1, minD = Infinity;
        for (let i = 0; i < cloth.particles.length; i++) {
            const p = cloth.particles[i];
            if (p.pinned) continue;
            const d = (p.x - hitPoint.x) ** 2 + (p.y - hitPoint.y) ** 2 + (p.z - hitPoint.z) ** 2;
            if (d < minD) { minD = d; nearest = i; }
        }
        if (nearest >= 0) {
            const p = cloth.particles[nearest];
            draggedParticles.push({
                index: nearest,
                ox: p.x - hitPoint.x,
                oy: p.y - hitPoint.y,
                oz: p.z - hitPoint.z
            });
        }
    } else {
        const radius = parseFloat(dragRadiusSlider.value);
        const r2 = radius * radius;
        for (let i = 0; i < cloth.particles.length; i++) {
            const p = cloth.particles[i];
            if (p.pinned) continue;
            const d2 = (p.x - hitPoint.x) ** 2 + (p.y - hitPoint.y) ** 2 + (p.z - hitPoint.z) ** 2;
            if (d2 < r2) {
                draggedParticles.push({
                    index: i,
                    ox: p.x - hitPoint.x,
                    oy: p.y - hitPoint.y,
                    oz: p.z - hitPoint.z
                });
            }
        }
    }

    if (draggedParticles.length > 0) {
        dragPlane.setFromNormalAndCoplanarPoint(getDragPlaneNormal(new THREE.Vector3()), hitPoint);
        return true;
    }
    return false;
}

function drawTearSpot(u, v, radius = 0.05, isTear = false) {
    if (!tearCtx) return;

    const x = u * tearCanvas.width;
    const y = (1 - v) * tearCanvas.height;

    let r = radius * tearCanvas.width * (isTear ? 1.8 : 1.5);

    if (cloth && cloth.resX && cloth.resY) {
        const cellW = tearCanvas.width / cloth.resX;
        const cellH = tearCanvas.height / cloth.resY;
        const minRadius = Math.hypot(cellW, cellH) * 0.8;
        r = Math.max(r, minRadius);
    }

    tearCtx.save();

    const grad = tearCtx.createRadialGradient(x, y, r * 0.1, x, y, r);
    grad.addColorStop(0, 'rgba(0, 0, 0, 1)');
    grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.8)');
    grad.addColorStop(0.9, 'rgba(0, 0, 0, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    tearCtx.fillStyle = grad;
    tearCtx.beginPath();
    tearCtx.arc(x, y, r, 0, Math.PI * 2);
    tearCtx.fill();

    const scatterCount = Math.floor(r * 1.5);
    for (let i = 0; i < scatterCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = r * (0.5 + Math.random() * 0.8);
        const rx = x + Math.cos(angle) * dist;
        const ry = y + Math.sin(angle) * dist;
        const rr = r * (0.05 + Math.random() * 0.15);

        const scatterGrad = tearCtx.createRadialGradient(rx, ry, 0, rx, ry, rr);
        scatterGrad.addColorStop(0, 'rgba(0, 0, 0, 0.8)');
        scatterGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        tearCtx.fillStyle = scatterGrad;
        tearCtx.beginPath();
        tearCtx.arc(rx, ry, rr, 0, Math.PI * 2);
        tearCtx.fill();
    }

    tearCtx.restore();
    if (tearTexture) tearTexture.needsUpdate = true;
}

function spawnClothDebris(idxA, idxB, idxC) {
    if (!cloth) return;
    if (debrisList.length >= MAX_DEBRIS) {
        const old = debrisList.shift();
        detachFromScene(old.mesh);
        old.mesh.geometry.dispose();
        if (old.mesh.material) old.mesh.material.dispose();
    }

    const pA = cloth.particles[idxA];
    const pB = cloth.particles[idxB];
    const pC = cloth.particles[idxC];

    const uA = new THREE.Vector2(pA.ix / cloth.resX, pA.iy / cloth.resY);
    const uB = new THREE.Vector2(pB.ix / cloth.resX, pB.iy / cloth.resY);
    const uC = new THREE.Vector2(pC.ix / cloth.resX, pC.iy / cloth.resY);

    const cx = (pA.x + pB.x + pC.x) / 3;
    const cy = (pA.y + pB.y + pC.y) / 3;
    const cz = (pA.z + pB.z + pC.z) / 3;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([
        pA.x - cx, pA.y - cy, pA.z - cz,
        pB.x - cx, pB.y - cy, pB.z - cz,
        pC.x - cx, pC.y - cy, pC.z - cz
    ], 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute([
        uA.x, uA.y,
        uB.x, uB.y,
        uC.x, uC.y
    ], 2));
    geom.computeVertexNormals();

    const useTex = textureEnabled && imageTexture;
    const mat = new THREE.MeshBasicMaterial({
        color: useTex ? 0xffffff : new THREE.Color(currentClothColor),
        map: useTex ? imageTexture : null,
        side: THREE.DoubleSide,
        transparent: clothOpacity < 1.0,
        opacity: clothOpacity,
        depthWrite: true
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(cx, cy, cz);
    scene.add(mesh);

    debrisList.push({
        mesh: mesh,
        vx: (Math.random() - 0.5) * 0.03,
        vy: -0.01,
        vz: (Math.random() - 0.5) * 0.03,
        vrx: (Math.random() - 0.5) * 0.15,
        vry: (Math.random() - 0.5) * 0.15,
        vrz: (Math.random() - 0.5) * 0.15
    });
}

function updateDebris(dt) {
    for (let i = debrisList.length - 1; i >= 0; i--) {
        const d = debrisList[i];

        d.vy -= 2.5 * dt;
        d.vx *= 0.98; d.vy *= 0.98; d.vz *= 0.98;

        d.mesh.position.x += d.vx;
        d.mesh.position.y += d.vy;
        d.mesh.position.z += d.vz;

        d.mesh.rotation.x += d.vrx;
        d.mesh.rotation.y += d.vry;
        d.mesh.rotation.z += d.vrz;

        if (d.mesh.position.y < -2.5) {
            detachFromScene(d.mesh);
            d.mesh.geometry.dispose();
            if (d.mesh.material) d.mesh.material.dispose();
            debrisList.splice(i, 1);
        }
    }
}

// 🪶 装饰物跟随用的临时向量/矩阵（复用，避免每帧每个装饰物都 new 一堆对象）
const _decorVX = new THREE.Vector3();
const _decorVY = new THREE.Vector3();
const _decorNormal = new THREE.Vector3();
const _decorForward = new THREE.Vector3();
const _decorUp = new THREE.Vector3();
const _decorRight = new THREE.Vector3();
const _decorTrueUp = new THREE.Vector3();
const _decorMat = new THREE.Matrix4();

function updateDecorations() {
    if (!cloth) return;
    // 🪶 低配模式：装饰物跟随降到每 2 帧一次（布料形变本来就慢，肉眼几乎无感）
    if (lowSpecMode) {
        updateDecorations._tick = (updateDecorations._tick || 0) + 1;
        if (updateDecorations._tick & 1) return;
    }
    for (let i = 0; i < decorations.length; i++) {
        // 💡 确保这一行定义了 d
        const d = decorations[i];
        if (d.particleIndex >= cloth.particles.length) continue;

        const p = cloth.particles[d.particleIndex];
        const ix = p.ix, iy = p.iy;
        const xR = Math.min(ix + 1, cloth.resX), yD = Math.min(iy + 1, cloth.resY);
        const pR = cloth.particles[iy * (cloth.resX + 1) + xR];
        const pD = cloth.particles[yD * (cloth.resX + 1) + ix];

        // 1. 求出布料在此处的局部方向
        const vX = _decorVX.set(pR.x - p.x, pR.y - p.y, pR.z - p.z).normalize();
        const vY = _decorVY.set(pD.x - p.x, pD.y - p.y, pD.z - p.z).normalize();
        
        let normal = _decorNormal.crossVectors(vX, vY).normalize();
        if (normal.z < 0) {
            normal.negate();
            vX.negate(); 
        }

        // 2. 计算悬浮高度 (非常贴合)
        let zOffset = d.radius * 0.5; 
        if (d.weight === 'light') zOffset = d.radius * 0.8;
        else if (d.weight === 'heavy') zOffset = d.radius * 0.2;

        const matType = decorPlacementList[i] ? decorPlacementList[i].mat : 'plastic';
        if (matType === 'jelly') {
            zOffset += d.radius * 0.3; 
        }

        // 3. 设置位置
        d.mesh.position.set(
            p.x + normal.x * zOffset,
            p.y + normal.y * zOffset,
            p.z + normal.z * zOffset + 0.05 
        );

        // 4. 锁定朝向
        const forward = _decorForward.copy(normal);
        const up = _decorUp.copy(vY).negate(); 
        const right = _decorRight.crossVectors(up, forward).normalize();
        const trueUp = _decorTrueUp.crossVectors(forward, right).normalize();

        _decorMat.makeBasis(right, trueUp, forward);
        d.mesh.quaternion.setFromRotationMatrix(_decorMat);

        // 5. 渲染排序（只在材质类型变化时重设，避免每帧 traverse）
        if (d._renderOrderMat !== matType) {
            d._renderOrderMat = matType;
            const ro = (matType === 'jelly') ? 1000 : 10;
            d.mesh.renderOrder = ro;
            d.mesh.traverse((child) => {
                if (child.isMesh) child.renderOrder = ro;
            });
        }
    }
}

function updateDragTarget(e) {
    if (draggedParticles.length === 0) return;
    raycaster.setFromCamera(getNDC(e), camera);
    const newTarget = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, newTarget);
    // 世界坐标 → holder 局部坐标（3D 镜头转过之后必须转换）
    if (newTarget && sceneHolder) newTarget.applyMatrix4(new THREE.Matrix4().copy(sceneHolder.matrixWorld).invert());

    // 🧷 拖固定点：直接把固定粒子搬到指针位置（保持它们的相对间距），布料会实时跟着走
    if (draggingPins && newTarget) {
        for (const item of draggedParticles) {
            const p = cloth.particles[item.index];
            p.x = newTarget.x + item.ox;
            p.y = newTarget.y + item.oy;
            p.z = newTarget.z + item.oz;
            // 固定点没有速度，避免松手瞬间把布料弹飞
            p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z;
        }
        if (cloth) cloth.wake();
        return;
    }

    if (newTarget) {
        let maxDist = parseFloat(maxDragDistanceSlider.value);
        if (dragMode === "tear") {
            maxDist = Infinity;
        }

        const dist = newTarget.distanceTo(dragOrigin);
        if (dist > maxDist) {
            const dir = newTarget.clone().sub(dragOrigin).normalize();
            newTarget.copy(dragOrigin).add(dir.multiplyScalar(maxDist));
        }

        if (dragDepthMode === 'outward') {
            newTarget.z += 1.0;
        } else if (dragDepthMode === 'inward') {
            newTarget.z -= 1.0;
        }

        for (const item of draggedParticles) {
            const p = cloth.particles[item.index];
            if (p.pinned) continue;

            const targetX = newTarget.x + item.ox;
            const targetY = newTarget.y + item.oy;
            const targetZ = newTarget.z + item.oz;

let dx = (targetX - p.x) * dragStrength;
let dy = (targetY - p.y) * dragStrength;
let dz = (targetZ - p.z) * dragStrength;

            const moveLen = Math.hypot(dx, dy, dz);
            // 单帧拖拽位移上限 ≈ 2 个网格间距（原来 0.15 ≈ 4.5 格，会把边硬拽成条）
            const maxStep = Math.max(0.03, (cloth.baseRestLength || 0.03) * 2);
            if (moveLen > maxStep) {
                const ratio = maxStep / moveLen;
                dx *= ratio; dy *= ratio; dz *= ratio;
            }

            p.x += dx;
            p.y += dy;
            p.z += dz;

            p.oldX = p.x - dx * 0.6;
            p.oldY = p.y - dy * 0.6;
            p.oldZ = p.z - dz * 0.6;
        }

        if (dragMode === "tear" && !isTearingFrame) {
            isTearingFrame = true;
            requestAnimationFrame(() => {
                tearAtParticles();
                isTearingFrame = false;
            });
        }
    }
}

function endDrag() {
    draggedParticles = [];
    draggingPins = false;
}

/**
 * 🧯 强制松手：手势被系统打断时（鼠标在窗口外松开、pointercancel、切标签页/失焦）
 * 必须把所有"抓取中"的质点解锁。
 *
 * 为什么非要有这个：求解器把被抓取的质点当成完全固定（invMass = 0），
 * 只要 draggedParticles / multiTouchMap 里残留了索引，那几块布就永远不参与解算 ——
 * 表现就是"某一块布像被隐形钉子钉住，再拽一下才松开"。
 */
function forceReleaseAllDrags() {
    if (draggedParticles.length > 0) endDrag();
    if (multiTouchMap.size > 0) {
        for (const id of Array.from(multiTouchMap.keys())) endMultiDrag(id);
        multiTouchMap.clear();
    }
    draggedParticles = [];
    draggingPins = false;
    draggingDecorIndex = -1;
    isCutting = false;
    isMovingCloth = false;
    isCanvasTouch = false;
    cam3DTouchLast = null;
    if (cloth) cloth.wake();
}

function tearAtParticles() {
    if (!cloth || dragMode !== "tear") return;
    const maxS = parseFloat(tearThresholdSlider.value);
    const grabRadius = parseFloat(dragRadiusSlider.value);
    let hasBroken = false;
    const brokenVerts = new Set();

    for (const item of draggedParticles) {
        const p = cloth.particles[item.index];
        if (p.pinned || !p.springs) continue;

        for (const sIdx of p.springs) {
            const s = cloth.springs[sIdx];
            if (s.broken) continue;

            const p1 = cloth.particles[s.i];
            const p2 = cloth.particles[s.j];
            const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);

            if (dist > s.restLength * maxS) {
                s.broken = true;
                hasBroken = true;
                brokenVerts.add(s.i);
                brokenVerts.add(s.j);

                const u1 = p1.ix / cloth.resX;
                const v1 = p1.iy / cloth.resY;
                const u2 = p2.ix / cloth.resX;
                const v2 = p2.iy / cloth.resY;
                drawTearSpot((u1 + u2) / 2, (v1 + v2) / 2, grabRadius * 0.8, true);
            }
        }
    }

    if (hasBroken) {
        const idxArr = cloth.mesh.geometry.index.array;
        const tIdxArr = cloth.thicknessGeometry.index.array;

        for (let i = 0; i < cloth.cutFaces.length; i++) {
            if (cloth.cutFaces[i]) continue;
            const a = cloth.originalIndexList[i * 3];
            const b = cloth.originalIndexList[i * 3 + 1];
            const c = cloth.originalIndexList[i * 3 + 2];

            if (brokenVerts.has(a) || brokenVerts.has(b) || brokenVerts.has(c)) {
                cloth.cutFaces[i] = 1;
                idxArr[i * 3] = 0;
                idxArr[i * 3 + 1] = 0;
                idxArr[i * 3 + 2] = 0;
                tIdxArr[i * 3] = 0;
                tIdxArr[i * 3 + 1] = 0;
                tIdxArr[i * 3 + 2] = 0;

                spawnClothDebris(a, b, c);
            }
        }
        cloth.mesh.geometry.index.needsUpdate = true;
        cloth.thicknessGeometry.index.needsUpdate = true;

        if (clothMesh.material.alphaMap !== tearTexture) {
            clothMesh.material.alphaMap = tearTexture;
            clothMesh.material.alphaTest = 0.05;
            clothMesh.material.transparent = true;
            clothMesh.material.depthWrite = true;
            clothMesh.material.needsUpdate = true;
        }
    }
}

function tryStartClothMove(e) {
    if (!cloth || !clothMesh) return false;
    
    // 清理可能存在的抓取状态，防止冲突
    if (typeof endDrag === 'function') endDrag();
    multiTouchMap.clear();

    raycaster.setFromCamera(getNDC(e), camera);
    const hits = raycaster.intersectObject(clothMesh, true);
    let hitPoint = new THREE.Vector3();
    
    if (hits.length > 0) {
        hitPoint.copy(hits[0].point);
    } else {
        // 如果没点中网格，通过二维平面虚拟出点
        if (!raycaster.ray.intersectPlane(clothMovePlane, hitPoint)) return false;
    }
    if (sceneHolder) hitPoint.applyMatrix4(new THREE.Matrix4().copy(sceneHolder.matrixWorld).invert());
    
    lastClothMovePoint = hitPoint.clone(); 
    clothMovePlane.setFromNormalAndCoplanarPoint(getDragPlaneNormal(new THREE.Vector3()), hitPoint);
    isMovingCloth = true;
    return true;
}

function updateClothMove(e) {
    if (!isMovingCloth || !lastClothMovePoint) return;
    raycaster.setFromCamera(getNDC(e), camera);
    const newPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(clothMovePlane, newPoint)) return;
    if (sceneHolder) newPoint.applyMatrix4(new THREE.Matrix4().copy(sceneHolder.matrixWorld).invert());
    
    // 计算这一帧鼠标移动的增量
    const dx = newPoint.x - lastClothMovePoint.x;
    const dy = newPoint.y - lastClothMovePoint.y;
    lastClothMovePoint.copy(newPoint);
    
    // 检查布料是否有“固定点”（画了红线，或默认的顶部固定）
    let hasPinned = false;
    for (let i = 0; i < cloth.particles.length; i++) {
        if (cloth.particles[i].pinned) {
            hasPinned = true;
            break;
        }
    }

    for (let i = 0; i < cloth.particles.length; i++) {
        const p = cloth.particles[i];
        
        if (hasPinned) {
            // 【核心修复】：如果有固定点，只移动固定点。
            // 相当于你提起了布料的边缘，其余部分交给物理引擎通过弹簧拉拽，自然产生摆动！
            if (p.pinned) {
                p.x += dx;
                p.y += dy;
                p.oldX += dx;
                p.oldY += dy;
            }
        } else {
            // 如果布料没有任何固定点（处于自由状态），则移动所有点
            // 但让 oldX/oldY 仅跟随 0.9 倍，制造一点点“惯性差”，从而产生自然的形变和漂浮感
            p.x += dx;
            p.y += dy;
            p.oldX += dx * 0.9;
            p.oldY += dy * 0.9;
        }
    }
    // 注意：这里千万不要调用 cloth.updateGeo()
    // 让 animate() 里的物理引擎循环去自动刷新，才会自然解算！
}

function applyClothRotation(newRotX, newRotY, newRotZ) {
    if (!cloth || !cloth.particles) {
        prevRotX = newRotX;
        prevRotY = newRotY;
        prevRotZ = newRotZ;
        return;
    }

    // 角度转弧度
    const targetX = newRotX * Math.PI / 180;
    const targetY = newRotY * Math.PI / 180;
    const targetZ = newRotZ * Math.PI / 180;
    const prevX = prevRotX * Math.PI / 180;
    const prevY = prevRotY * Math.PI / 180;
    const prevZ = prevRotZ * Math.PI / 180;

    // 计算增量
    const deltaX = targetX - prevX;
    const deltaY = targetY - prevY;
    const deltaZ = targetZ - prevZ;

    if (Math.abs(deltaX) > 1e-5 || Math.abs(deltaY) > 1e-5 || Math.abs(deltaZ) > 1e-5) {
        // 1. 计算布料的几何中心（质心）
        let cx = 0, cy = 0, cz = 0;
        const n = cloth.particles.length;
        for (let p of cloth.particles) { cx += p.x; cy += p.y; cz += p.z; }
        cx /= n; cy /= n; cz /= n;

        const cosX = Math.cos(deltaX), sinX = Math.sin(deltaX);
        const cosY = Math.cos(deltaY), sinY = Math.sin(deltaY);
        const cosZ = Math.cos(deltaZ), sinZ = Math.sin(deltaZ);

        // 2. 对每个粒子进行三维旋转
        for (let p of cloth.particles) {
            // 相对于质心的坐标
            let dx = p.x - cx;
            let dy = p.y - cy;
            let dz = p.z - cz;

            // 绕 X 轴旋转
            let ny = dy * cosX - dz * sinX;
            let nz = dy * sinX + dz * cosX;
            dy = ny; dz = nz;

            // 绕 Y 轴旋转
            let nx = dx * cosY + dz * sinY;
            nz = -dx * sinY + dz * cosY;
            dx = nx; dz = nz;

            // 绕 Z 轴旋转
            nx = dx * cosZ - dy * sinZ;
            ny = dx * sinZ + dy * cosZ;
            dx = nx; dy = ny;

            // 更新位置
            p.x = cx + dx;
            p.y = cy + dy;
            p.z = cz + dz;

            // ==============================================================
            // 🔧 核心修改：不再强行完美同步 oldX/Y/Z！
            // 我们让历史坐标向新坐标靠拢，产生一个速度差，也就是“惯性”。
            // 这样物理引擎在下一帧解算时，就会把布料当成在空气中猛烈甩动，
            // 弹簧约束、风力、重力都会瞬间介入，产生布料该有的波浪和褶皱。
            // ==============================================================
            p.oldX += (p.x - p.oldX) * 0.1;
            p.oldY += (p.y - p.oldY) * 0.1;
            p.oldZ += (p.z - p.oldZ) * 0.1;
        }
    }

    prevRotX = newRotX;
    prevRotY = newRotY;
    prevRotZ = newRotZ;
}

function endClothMove() {
    isMovingCloth = false;
    lastClothMovePoint = null;
}

function tryStartMultiDrag(touch) {
    if (!isSimulating || !clothMesh || !cloth) return;
    const ndc = getNDCFromClient(touch.clientX, touch.clientY);
    raycaster.setFromCamera(ndc, camera);

    let hitPoint = new THREE.Vector3();
    const plane = new THREE.Plane(getDragPlaneNormal(new THREE.Vector3()), 0);
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;
    if (sceneHolder) hitPoint.applyMatrix4(new THREE.Matrix4().copy(sceneHolder.matrixWorld).invert());

    const radius = parseFloat(dragRadiusSlider.value);
    const r2 = radius * radius;
    const grabbed = [];
    let grabbedPins = false;

    // 🧷 多指模式下也支持拖固定点
    if (pinDragEnabled) {
        const pinR2 = (radius * 1.4) * (radius * 1.4);
        let nearestPin = -1, bestD = pinR2;
        for (let i = 0; i < cloth.particles.length; i++) {
            const p = cloth.particles[i];
            if (!p.pinned) continue;
            const d2 = (p.x - hitPoint.x) ** 2 + (p.y - hitPoint.y) ** 2 + (p.z - hitPoint.z) ** 2;
            if (d2 < bestD) { bestD = d2; nearestPin = i; }
        }
        if (nearestPin >= 0) {
            const anchorP = cloth.particles[nearestPin];
            // 整片连通固定点一起拖（按网格 8 邻域连通）
            const pinSet = new Set();
            const byGrid = new Map();
            for (let i = 0; i < cloth.particles.length; i++) {
                const p = cloth.particles[i];
                if (!p.pinned) continue;
                pinSet.add(i);
                byGrid.set(p.ix + "," + p.iy, i);
            }
            const cluster = new Set();
            const queue = [nearestPin];
            while (queue.length) {
                const idx = queue.pop();
                if (cluster.has(idx) || !pinSet.has(idx)) continue;
                cluster.add(idx);
                const p = cloth.particles[idx];
                for (let ddx = -1; ddx <= 1; ddx++) {
                    for (let ddy = -1; ddy <= 1; ddy++) {
                        if (ddx === 0 && ddy === 0) continue;
                        const ni = byGrid.get((p.ix + ddx) + "," + (p.iy + ddy));
                        if (ni !== undefined && !cluster.has(ni)) queue.push(ni);
                    }
                }
            }
            for (const idx of cluster) {
                const p = cloth.particles[idx];
                grabbed.push({ index: idx, ox: p.x - hitPoint.x, oy: p.y - hitPoint.y, oz: p.z - hitPoint.z });
            }
            grabbedPins = grabbed.length > 0;
        }
    }

    for (let i = 0; !grabbedPins && i < cloth.particles.length; i++) {
        const p = cloth.particles[i];
        if (p.pinned) continue;
        const d2 = (p.x - hitPoint.x) ** 2 + (p.y - hitPoint.y) ** 2 + (p.z - hitPoint.z) ** 2;
        if (d2 < r2) {
            grabbed.push({
                index: i,
                ox: p.x - hitPoint.x,
                oy: p.y - hitPoint.y,
                oz: p.z - hitPoint.z
            });
        }
    }

    if (grabbed.length > 0) {
        const dragPlane = new THREE.Plane(getDragPlaneNormal(new THREE.Vector3()), 0);
        dragPlane.setFromNormalAndCoplanarPoint(getDragPlaneNormal(new THREE.Vector3()), hitPoint);
        multiTouchMap.set(touch.identifier, {
            plane: dragPlane,
            origin: hitPoint.clone(),
            dragged: grabbed,
            pinDrag: grabbedPins
        });
    }
}

function updateMultiDrag(touch) {
    const data = multiTouchMap.get(touch.identifier);
    if (!data) return;

    const ndc = getNDCFromClient(touch.clientX, touch.clientY);
    raycaster.setFromCamera(ndc, camera);
    const newTarget = new THREE.Vector3();
    raycaster.ray.intersectPlane(data.plane, newTarget);
    if (newTarget && sceneHolder) newTarget.applyMatrix4(new THREE.Matrix4().copy(sceneHolder.matrixWorld).invert());

    if (newTarget) {
        const maxDist = parseFloat(maxDragDistanceSlider.value);
        const dist = newTarget.distanceTo(data.origin);
        if (dist > maxDist) {
            const dir = newTarget.clone().sub(data.origin).normalize();
            newTarget.copy(data.origin).add(dir.multiplyScalar(maxDist));
        }

        if (dragDepthMode === 'outward') {
            newTarget.z += 1.0;
        } else if (dragDepthMode === 'inward') {
            newTarget.z -= 1.0;
        }

        if (data.pinDrag) {
            // 🧷 拖固定点：直接把固定粒子搬到目标位置，布料实时跟随
            for (const item of data.dragged) {
                const p = cloth.particles[item.index];
                p.x = newTarget.x + item.ox;
                p.y = newTarget.y + item.oy;
                p.z = newTarget.z + item.oz;
                p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z;
            }
            if (cloth) cloth.wake();
            return;
        }

        for (const item of data.dragged) {
            const p = cloth.particles[item.index];
            if (p.pinned) continue;

            const targetX = newTarget.x + item.ox;
            const targetY = newTarget.y + item.oy;
            const targetZ = newTarget.z + item.oz;

            let dx = (targetX - p.x) * 0.4;
            let dy = (targetY - p.y) * 0.4;
            let dz = (targetZ - p.z) * 0.4;

            const moveLen = Math.hypot(dx, dy, dz);
            // 单帧拖拽位移上限 ≈ 2 个网格间距（原来 0.15 ≈ 4.5 格，会把边硬拽成条）
            const maxStep = Math.max(0.03, (cloth.baseRestLength || 0.03) * 2);
            if (moveLen > maxStep) {
                const ratio = maxStep / moveLen;
                dx *= ratio; dy *= ratio; dz *= ratio;
            }

            p.x += dx;
            p.y += dy;
            p.z += dz;

            p.oldX = p.x - dx * 0.6;
            p.oldY = p.y - dy * 0.6;
            p.oldZ = p.z - dz * 0.6;
        }
    }
}

function endMultiDrag(touchId) {
    const data = multiTouchMap.get(touchId);
    if (!data) return;
    multiTouchMap.delete(touchId);
}

function cleanupMultiTouch(activeTouches) {
    if (dragMode !== 'multi') return;
    const activeIds = Array.from(activeTouches).map(t => t.identifier);
    for (const id of Array.from(multiTouchMap.keys())) {
        if (!activeIds.includes(id)) {
            endMultiDrag(id);
        }
    }
}

function erasePinStroke(pt) {
    const eraseRadius = parseFloat(pinRadiusSlider.value);
    let changed = false;
    let newPinStrokeList = [];

    if (eraserMode === "whole") {
        for (let i = pinStrokeList.length - 1; i >= 0; i--) {
            const stroke = pinStrokeList[i].points;
            const w = pinStrokeList[i].w;
            let hit = false;
            for (let s = 0; s < stroke.length - 1; s++) {
                const dist = pointSegmentDistance(pt.x, pt.y, stroke[s].x, stroke[s].y, stroke[s + 1].x, stroke[s + 1].y);
                if (dist < eraseRadius + w) {
                    hit = true;
                    break;
                }
            }
            if (hit) {
                changed = true;
            } else {
                newPinStrokeList.unshift(pinStrokeList[i]);
            }
        }
        if (changed) pinStrokeList = newPinStrokeList;
    } else {
        for (const strokeObj of pinStrokeList) {
            const stroke = strokeObj.points;
            const w = strokeObj.w;
            let strokeChanged = false;
            let currentSubStroke = [stroke[0]];
            let subStrokes = [];

            for (let i = 0; i < stroke.length - 1; i++) {
                const p1 = stroke[i];
                const p2 = stroke[i+1];
                const dist = pointSegmentDistance(pt.x, pt.y, p1.x, p1.y, p2.x, p2.y);

                if (dist < eraseRadius + w) {
                    strokeChanged = true;
                    if (currentSubStroke.length > 1) {
                        subStrokes.push({ points: currentSubStroke, w: w });
                    }
                    currentSubStroke = [];
                } else {
                    if (currentSubStroke.length === 0) currentSubStroke.push(p1);
                    currentSubStroke.push(p2);
                }
            }
            if (currentSubStroke.length > 1) {
                subStrokes.push({ points: currentSubStroke, w: w });
            }
            if (strokeChanged) {
                changed = true;
                newPinStrokeList.push(...subStrokes);
            } else {
                newPinStrokeList.push(strokeObj);
            }
        }
        if (changed) pinStrokeList = newPinStrokeList;
    }
    if (changed) redrawPreview();
}

function cutCloth(e) {
    if (!clothMesh || !cloth) return;
    raycaster.setFromCamera(getNDC(e), camera);
    const knifeRadius = parseFloat(knifeRadiusSlider.value);
    const line = raycaster.ray;

    let changed = false;
    const affectedVerts = new Set();

    for (let i = 0; i < cloth.particles.length; i++) {
        const p = cloth.particles[i];
        const pt = new THREE.Vector3(p.x, p.y, p.z);
        const dist = line.distanceToPoint(pt);

        if (dist < knifeRadius) {
            affectedVerts.add(i);
            const u = p.ix / cloth.resX;
            const v = p.iy / cloth.resY;
            drawTearSpot(u, v, knifeRadius * 1.5, false);
            changed = true;

            if (p.springs) {
                for (const sIdx of p.springs) {
                    cloth.springs[sIdx].broken = true;
                }
            }
        }
    }

    if (affectedVerts.size === 0) return;

    const idxArr = cloth.mesh.geometry.index.array;
    const tIdxArr = cloth.thicknessGeometry.index.array;

    for (let i = 0; i < cloth.cutFaces.length; i++) {
        if (cloth.cutFaces[i]) continue;
        const a = cloth.originalIndexList[i * 3];
        const b = cloth.originalIndexList[i * 3 + 1];
        const c = cloth.originalIndexList[i * 3 + 2];

        if (affectedVerts.has(a) || affectedVerts.has(b) || affectedVerts.has(c)) {
            cloth.cutFaces[i] = 1;
            idxArr[i * 3] = 0;
            idxArr[i * 3 + 1] = 0;
            idxArr[i * 3 + 2] = 0;
            tIdxArr[i * 3] = 0;
            tIdxArr[i * 3 + 1] = 0;
            tIdxArr[i * 3 + 2] = 0;

            spawnClothDebris(a, b, c);

            changed = true;
        }
    }

    if (changed) {
        cloth.mesh.geometry.index.needsUpdate = true;
        cloth.thicknessGeometry.index.needsUpdate = true;

        if (clothMesh.material.alphaMap !== tearTexture) {
            clothMesh.material.alphaMap = tearTexture;
            clothMesh.material.alphaTest = 0.05;
            clothMesh.material.transparent = true;
            clothMesh.material.depthWrite = true;
            clothMesh.material.needsUpdate = true;
        }
    }
}

function onPointerDown(e) {
    if (!editMode) {
        // 🧷 允许拖动固定点时，优先判断是否抓住固定点
        if (pinDragEnabled && tryStartPinDrag(e)) { e.preventDefault(); return; }
        // 👇 新增：如果开启了整体移动，优先执行
        if (clothMoveEnabled) {
            if (tryStartClothMove(e)) {
                e.preventDefault();
                return; // 直接返回，不再执行后续的抓取拉扯
            }
        }
        
        if (dragMode === "knife") { isCutting = true; cutCloth(e); return; }
        if (clothMesh && tryStartDrag(e)) e.preventDefault();
        return;
    }
    if (!loadedImage) return;

    if (drawMode === "eraser") { isErasing = true; saveHistory(); erasePinStroke(getPreviewPointer(e)); return; }

    if (drawMode === "decor") {
        const pt = getPreviewPointer(e);
        let maxW = BOUND_SCALE * 2 * 0.95;
        let maxH = maxW;
        if (imgAspect >= 1) maxH = maxW / imgAspect; else maxW = maxH * imgAspect;

        if (pt.x >= -maxW/2 && pt.x <= maxW/2 && pt.y >= -maxH/2 && pt.y <= maxH/2) {

            // ✅ 修复：使用物理尺寸判定热区（之前的 8 像素单位太大，导致全屏选中）
            let hitIndex = -1;
            for (let i = decorPlacementList.length - 1; i >= 0; i--) {
                const d = decorPlacementList[i];
                const clickRadius = 0.06 * (d.size || 1.0); 
                if (Math.hypot(pt.x - d.x, pt.y - d.y) <= clickRadius) {
                    hitIndex = i;
                    break;
                }
            }

            if (hitIndex >= 0) {
                // 选中并开始拖拽
                selectedDecorIndex = hitIndex;
                draggingDecorIndex = hitIndex;
                decorDefaultSettings.style.display = "none";
                decorSelectedSettings.style.display = "block";
                syncSelectedDecorToUI();
                redrawPreview();
            } else {
                // 没点中，新建一个
                saveHistory();
                clearSelection();
                const type = decorTypeSelect.value;
                const mat = decorMatSelect.value;
                const weight = decorWeightSelect.value;
                const size = parseFloat(decorSizeSlider.value);
                const color = decorColors[Math.floor(Math.random() * decorColors.length)];
                decorPlacementList.push({ x: pt.x, y: pt.y, type: type, color: color, mat: mat, weight: weight, size: size });
                redrawPreview();
            }
        }
        return;
    }

    isDrawing = true;
    const pt = getPreviewPointer(e);
    currentPinStroke = [pt];
    currentPinStrokeWidth = parseFloat(pinRadiusSlider.value);
}

function onPointerMove(e) {
    // 🧯 鼠标在窗口外松开后再移回来：mouseup 不会到达窗口，这里用 buttons === 0 兜底松手
    if (!editMode && draggedParticles.length > 0 && e && e.buttons === 0) {
        forceReleaseAllDrags();
        return;
    }
    if (!editMode) {
        // 👇 新增：处理整体移动
        if (isMovingCloth) { 
            e.preventDefault(); 
            updateClothMove(e); 
            return; 
        }

        if (isCutting) { cutCloth(e); return; }
        if (draggedParticles.length > 0) { e.preventDefault(); updateDragTarget(e); }
        return;
    }
    if (drawMode === "eraser") { if (isErasing) erasePinStroke(getPreviewPointer(e)); return; }

    if (drawMode === "decor" && draggingDecorIndex >= 0) {
        const pt = getPreviewPointer(e);
        let maxW = BOUND_SCALE * 2 * 0.95;
        let maxH = maxW;
        if (imgAspect >= 1) maxH = maxW / imgAspect; else maxW = maxH * imgAspect;

        pt.x = Math.max(-maxW/2, Math.min(maxW/2, pt.x));
        pt.y = Math.max(-maxH/2, Math.min(maxH/2, pt.y));

        decorPlacementList[draggingDecorIndex].x = pt.x;
        decorPlacementList[draggingDecorIndex].y = pt.y;
        redrawPreview();
        return;
    }

    if (!isDrawing) return;
    const pt = getPreviewPointer(e);
    currentPinStroke.push(pt);
    redrawPreview();
}

function onPointerUp() {
    if (!editMode) {
        // 👇 新增：结束整体移动
        if (isMovingCloth) { 
            endClothMove(); 
            if (draggedParticles.length > 0) endDrag();
            return; 
        }

        if (isCutting) {
            isCutting = false;
            saveHistory();
            if (draggedParticles.length > 0) endDrag();   // 中途切模式时也别把抓取状态留下
            return;
        }
        if (draggedParticles.length > 0) endDrag();
        return;
    }
    if (drawMode === "eraser") { isErasing = false; return; }

    if (drawMode === "decor" && draggingDecorIndex >= 0) {
        draggingDecorIndex = -1;
        return;
    }

    if (!isDrawing) return;
    isDrawing = false;
    saveStroke();
}

canvasHost.addEventListener("mousedown", e => { if (e.target.closest('.float-back-btn')) return; onPointerDown(e); });
window.addEventListener("mousemove", e => { if (e.target.closest('.float-back-btn')) return; onPointerMove(e); });
window.addEventListener("mouseup", e => { if (e.target.closest('.float-back-btn')) return; onPointerUp(); });

// 🧯 手势被系统打断时的兜底松手（否则抓取中的质点会永远锁死）
window.addEventListener("pointercancel", forceReleaseAllDrags);
window.addEventListener("blur", forceReleaseAllDrags);
document.addEventListener("visibilitychange", () => { if (document.hidden) forceReleaseAllDrags(); });
canvasHost.addEventListener("contextmenu", e => e.preventDefault());

canvasHost.addEventListener("wheel", e => {
    e.preventDefault();
    // 🎥 3D 镜头开启时，滚轮直接推拉镜头（比再去拖 2D 缩放滑杆顺手）
    if (cam3DEnabled && !editMode) {
        const dir = e.deltaY > 0 ? -1 : 1;
        cam3DZoom = Math.max(0.35, Math.min(2.5, cam3DZoom * (1 + dir * 0.08)));
        applyCamera3D();
        return;
    }
    // 缩放可以一路收到 0；越接近 0 步长越小，方便微调
    const dir = e.deltaY > 0 ? 1 : -1;
    const stepSize = Math.max(0.01, zoom * 0.12);
    zoom = Math.max(0, Math.min(3, zoom + dir * stepSize));
    zoomSlider.value = zoom;
    document.getElementById("zoomValue").textContent = zoom.toFixed(2);
    updateCamera();
}, { passive: false });

canvasHost.addEventListener("touchstart", e => {
    if (e.target.closest('.float-back-btn')) return;
    // 🎥 3D 镜头开启且不在编辑模式：单指拖动直接转镜头
    if (cam3DEnabled && !editMode && e.touches.length === 1) {
        cam3DTouchLast = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        isCanvasTouch = false;
        e.preventDefault();
        return;
    }
    isCanvasTouch = true;
    if (editMode) { if (e.touches.length === 1) onPointerDown(e); return; }
    if (dragMode === "knife") {
        if (e.touches.length === 1) {
            e.preventDefault();
            onPointerDown(e);
        } else if (e.touches.length === 2) {
            e.preventDefault();
            endDrag();
            isDrawing = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchDistStart = Math.hypot(dx, dy);
        }
        return;
    }
    if (dragMode === 'multi') {
        e.preventDefault();
        cleanupMultiTouch(e.touches);
        for (let i = 0; i < e.touches.length; i++) {
            tryStartMultiDrag(e.touches[i]);
        }
    } else {
        if (e.touches.length === 1) {
            e.preventDefault();
            onPointerDown(e);
        } else if (e.touches.length === 2) {
            e.preventDefault();
            endDrag();
            isDrawing = false;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            touchDistStart = Math.hypot(dx, dy);
        }
    }
}, { passive: false });

window.addEventListener("touchmove", e => {
    if (!isCanvasTouch) {
        // 🎥 3D 镜头拖动中
        if (cam3DTouchLast && cam3DEnabled && !editMode && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - cam3DTouchLast.x;
            const dy = t.clientY - cam3DTouchLast.y;
            cam3DTouchLast = { x: t.clientX, y: t.clientY };
             cam3DYaw = Math.max(-180, Math.min(180, cam3DYaw - dx * 0.35));
             cam3DPitch = Math.max(-80, Math.min(80, cam3DPitch - dy * 0.28));
            applyCamera3D();
            e.preventDefault();
        }
        return;
    }
    if (e.target.closest('.float-back-btn')) return;
    if (editMode) { if (e.touches.length === 1) onPointerMove(e); return; }
    if (dragMode === "knife") {
        if (e.touches.length === 1) {
            e.preventDefault();
            onPointerMove(e);
        } else if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            if (touchDistStart > 0) {
                const delta = (touchDistStart - dist) / 300;
                zoom = Math.max(0, Math.min(3, zoom + delta));
                zoomSlider.value = zoom;
                document.getElementById("zoomValue").textContent = zoom.toFixed(2);
                updateCamera();
            }
            touchDistStart = dist;
        }
        return;
    }
    if (dragMode === 'multi') {
        e.preventDefault();
        cleanupMultiTouch(e.touches);
        for (let i = 0; i < e.touches.length; i++) {
            updateMultiDrag(e.touches[i]);
        }
    } else {
        if (e.touches.length === 1) {
            e.preventDefault();
            onPointerMove(e);
        } else if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            if (touchDistStart > 0) {
                const delta = (touchDistStart - dist) / 300;
                zoom = Math.max(0, Math.min(3, zoom + delta));
                zoomSlider.value = zoom;
                document.getElementById("zoomValue").textContent = zoom.toFixed(2);
                updateCamera();
            }
            touchDistStart = dist;
        }
    }
}, { passive: false });

function handleTouchEnd(e) {
    // 🎥 手机拖动镜头结束
    if (cam3DTouchLast && (!e.touches || e.touches.length === 0)) {
        cam3DTouchLast = null;
        return;
    }
    if (!isCanvasTouch) return;
    if (e.target.closest('.float-back-btn')) {
        isCanvasTouch = false;
        return;
    }
    if (editMode) {
        onPointerUp();
        if (e.touches.length === 0) isCanvasTouch = false;
        return;
    }
    if (dragMode === "knife") {
        if (e.touches.length === 0) {
            onPointerUp();
            touchDistStart = 0;
            isCanvasTouch = false;
        } else if (e.touches.length === 1) {
            touchDistStart = 0;
        }
        return;
    }
    if (dragMode === 'multi') {
        cleanupMultiTouch(e.touches);
        if (e.touches.length === 0) {
            for (const id of Array.from(multiTouchMap.keys())) {
                endMultiDrag(id);
            }
            isCanvasTouch = false;
        }
    } else {
        if (e.touches.length === 0) {
            onPointerUp();
            touchDistStart = 0;
            isCanvasTouch = false;
        }
    }
}

window.addEventListener("touchend", handleTouchEnd);
window.addEventListener("touchcancel", handleTouchEnd);

function saveStroke() {
    if (currentPinStroke.length > 3) {
        saveHistory();
        pinStrokeList.push({ points: [...currentPinStroke], w: currentPinStrokeWidth });
    }
    currentPinStroke = [];
    redrawPreview();
    updateEmptyGuide();   // 已经画了固定线，第二步引导自动收起来
}

function redrawPreview() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (!loadedImage) return;
    const imgW = loadedImage.width, imgH = loadedImage.height;
    const scale = Math.min(CANVAS_W / imgW, CANVAS_H / imgH);
    const dw = imgW * scale, dh = imgH * scale;
    const dx = (CANVAS_W - dw) / 2, dy = (CANVAS_H - dh) / 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
    ctx.translate(dx + dw / 2, dy + dh / 2);
    if (flipH) ctx.scale(-1, 1);
    if (flipV) ctx.scale(1, -1);
    ctx.drawImage(loadedImage, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    if (showGrid) {
        ctx.save(); ctx.strokeStyle = "#cccccc"; ctx.lineWidth = 1;
        const stepX = dw / 10, stepY = dh / 10;
        ctx.beginPath();
        for (let i = 0; i <= 10; i++) {
            ctx.moveTo(dx + i * stepX, dy); ctx.lineTo(dx + i * stepX, dy + dh);
            ctx.moveTo(dx, dy + i * stepY); ctx.lineTo(dx + dw, dy + i * stepY);
        }
        ctx.stroke(); ctx.restore();
    }

    ctx.strokeStyle = "#f3a3a3";
    for (const s of pinStrokeList) drawStroke(s.points, s.w);
    if (currentPinStroke.length > 0) drawStroke(currentPinStroke, currentPinStrokeWidth);

    for (let i = 0; i < decorPlacementList.length; i++) {
        const d = decorPlacementList[i];
        let maxW = BOUND_SCALE * 2 * 0.95;
        let maxH = maxW;
        if (imgAspect >= 1) maxH = maxW / imgAspect; else maxW = maxH * imgAspect;
        let u = (d.x + maxW / 2) / maxW;
        let v = (maxH / 2 - d.y) / maxH;
        const sx = dx + u * dw;
        const sy = dy + v * dh;

        ctx.beginPath();
        const drawRadius = 6 * (d.size || 1.0);

        ctx.arc(sx, sy, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        if (d.mat === 'jelly') ctx.globalAlpha = 0.6; else ctx.globalAlpha = 1.0;
        ctx.fill();
        ctx.globalAlpha = 1.0;

        ctx.strokeStyle = d.mat === 'metal' ? "#555" : "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();

        if (i === selectedDecorIndex) {
            ctx.beginPath();
            ctx.arc(sx, sy, drawRadius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = "#FF6B81";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

function drawStroke(points, w) {
    if (points.length < 2 || !loadedImage) return;
    const imgW = loadedImage.width, imgH = loadedImage.height;
    const scale = Math.min(CANVAS_W / imgW, CANVAS_H / imgH);
    const dw = imgW * scale, dh = imgH * scale;
    const dx = (CANVAS_W - dw) / 2, dy = (CANVAS_H - dh) / 2;

    let maxW = BOUND_SCALE * 2 * 0.95;
    let maxH = maxW;
    if (imgAspect >= 1) {
        maxH = maxW / imgAspect;
    } else {
        maxW = maxH * imgAspect;
    }

    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let u = (p.x + maxW / 2) / maxW;
        let v = (maxH / 2 - p.y) / maxH;

        const sx = dx + u * dw;
        const sy = dy + v * dh;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.lineWidth = w * Math.max(dw, dh) * 0.673;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
}

function pointSegmentDistance(px, py, x0, y0, x1, y1) {
    const A = px - x0, B = py - y0, C = x1 - x0, D = y1 - y0;
    const dot = A * C + B * D, lenSq = C * C + D * D;
    if (lenSq === 0) return Math.hypot(A, B);
    let t = dot / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x0 + t * C), py - (y0 + t * D));
}

function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const img = new Image();
    img.onload = () => {
        loadedImage = img; flipH = false; flipV = false;
        imgAspect = img.width / img.height;
        destroyCloth();
        pinStrokeList = []; currentPinStroke = []; decorPlacementList = [];
    if (typeof resetCamera3D === "function") resetCamera3D();
    const camToggle = document.getElementById("toggleCam3D");
    if (camToggle) { camToggle.checked = false; cam3DEnabled = false; }
        clearSelection();
        refreshImageTexture();
        setEditMode(true);
        redrawPreview();
    };
    img.src = URL.createObjectURL(file);
}

document.getElementById("fileInput").addEventListener("change", e => loadImageFile(e.target.files[0]));

let dragCounter = 0;
window.addEventListener("dragenter", e => {
    e.preventDefault(); dragCounter++;
    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) dropZone.classList.add('active');
});
window.addEventListener("dragover", e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener("dragleave", e => {
    e.preventDefault(); dragCounter--;
    if (dragCounter === 0) dropZone.classList.remove('active');
});
window.addEventListener("drop", e => {
    e.preventDefault(); dragCounter = 0; dropZone.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files.length > 0) loadImageFile(e.dataTransfer.files[0]);
});

// 从它真正的父节点移除（3D 镜头开启后，布料/装饰挂在 sceneHolder 上，不是 scene）
function detachFromScene(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    else if (scene) scene.remove(obj);
}

function disposeObject3D(obj) {
    if (!obj) return;
    obj.traverse(node => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
            if (Array.isArray(node.material)) node.material.forEach(m => m && m.dispose());
            else node.material.dispose();
        }
    });
}

function destroyCloth() {
    if (clothMesh) { detachFromScene(clothMesh); disposeObject3D(clothMesh); clothMesh = null; cloth = null; }
    if (outlineMesh) { detachFromScene(outlineMesh); disposeObject3D(outlineMesh); outlineMesh = null; outlineMat = null; }
    if (thicknessMesh) { detachFromScene(thicknessMesh); disposeObject3D(thicknessMesh); thicknessMesh = null; thicknessMat = null; }
    if (velocityMesh && velocityScene) { velocityScene.remove(velocityMesh); velocityMesh = null; }
    // 固定点提示圆点也一起清掉（重建布料后会重新生成）
    if (pinDotsMesh) { detachFromScene(pinDotsMesh); disposeObject3D(pinDotsMesh); pinDotsMesh = null; pinDotsGeo = null; }
    multiTouchMap.clear();
    draggedParticles = [];
    clothWetness = 0; waterEnabled = false; lastWetnessPercent = -1;
    if (wetnessValueEl) wetnessValueEl.textContent = "0.0%";
    activeShaderRef = null;
    if (waterDropNormalTexture) { waterDropNormalTexture.dispose(); waterDropNormalTexture = null; }
    if (waterTexRebuildTimer) { clearTimeout(waterTexRebuildTimer); waterTexRebuildTimer = null; }
    for (const d of debrisList) { detachFromScene(d.mesh); disposeObject3D(d.mesh); }
    debrisList = [];
    if (tearCtx) { tearCtx.fillStyle = '#ffffff'; tearCtx.fillRect(0, 0, tearCanvas.width, tearCanvas.height); if (tearTexture) tearTexture.needsUpdate = true; }
    decorations.forEach(d => { detachFromScene(d.mesh); disposeObject3D(d.mesh); });
    decorations = [];
    clothMoveEnabled = false;
    endClothMove();
    const moveToggle = document.getElementById("toggleClothMove");
    if (moveToggle) moveToggle.checked = false;
    // 保险：即使 mesh 已被外部清掉，物理对象也一定要置空（否则下次生成会残留旧布料）
    cloth = null;
    draggingPins = false;
}

// ==============================================================
// 🪶 低配模式（Low-Spec Mode）总控
// --------------------------------------------------------------
// 开关打开后：
//   · 物理解算切到 physics-lowspec.js 里的数组化求解器（单子步 + 静止休眠）
//   · 物理更新率 / 约束迭代 / 网格分辨率按低配上限限幅
//   · 渲染像素比、阴影贴图降档，动态模糊自动跳过
// 经典模式（关闭）时仍然走下面原有的 Cloth.simulate，逻辑完全不变。
// ==============================================================
const LOW_SPEC_KEY = "rin_cloth_low_spec";

let lowSpecMode = false;

const toggleLowSpecEl = document.getElementById("toggleLowSpec");
const lowSpecBadgeEl = document.getElementById("lowSpecBadge");
const lowSpecFpsEl = document.getElementById("lowSpecFps");
const perfSolverEl = document.getElementById("perfSolver");
const perfModeLabelEl = document.getElementById("perfModeLabel");
const physicsHzEl = document.getElementById("physicsHz");
const constraintIterationsEl = document.getElementById("constraintIterations");

const lowSpecLockBuf = [];

// 🧵 求解器宿主适配层：经典模式与低配模式共用
// （以前叫 lowSpecHost，只有低配走它；现在两种模式都走统一求解器）
const clothSolverHost = {
    // 每帧读一次 UI/全局参数，之后热循环里不再碰 DOM
    getParams(out) {
        out.simMult = parseFloat(simMultSlider.value) || 1;
        out.wind = windEnabled ? (parseFloat(windSlider.value) || 0) : 0;
        out.windDir = parseFloat(windDirSlider.value) || 0;
        out.stiffness = parseFloat(stiffnessSlider.value) || 0.45;
        out.stretchLimit = Math.max(1.001, parseFloat(maxStretchSlider.value) || 1.5);
        out.damping = parseFloat(dampingSlider.value) || 0;
        out.mass = Math.max(0.1, parseFloat(massSlider.value) || 25);
        out.noiseAmp = parseFloat(windNoiseAmpSlider.value);
        out.noiseRandom = parseFloat(windRandomSlider.value);
        out.noiseSpeed = parseFloat(windSpeedSlider.value);
        out.gravity = parseFloat(gravitySlider.value) || 0;
        out.gravityAngle = gravityAngle;
        out.windSpatialFreq = windSpatialFreq;
        out.windZ = windZ;
        out.airDampingExp = airDampingExp;
        out.velocityRetention = velocityRetention;
        out.maxVelocity = maxVelocity;
        out.shear = shearStiffness;
        out.stiffX = stiffX;
        out.stiffY = stiffY;
        out.bend = bendStiffness;
        out.springDamp = springDamping;
        out.iterations = parseInt(constraintIterationsEl.value) || 6;
        out.plasticity = plasticityEnabled;
        out.plasticityRate = plasticityRate;
        out.plasticityThreshold = plasticityThreshold;
        out.plasticityRecovery = plasticityRecovery;
        out.plasticityMax = plasticityMax;
        out.groundEnabled = groundCollisionEnabled;
        out.groundY = groundY;
        out.groundFriction = groundFriction;
        out.collision = collisionEnabled;
        out.collisionIters = parseInt(collisionItersSlider.value) || 2;
        out.collisionLight = !!(collisionQualitySelect && collisionQualitySelect.value === "light");
        out.sleepGuard = !!(toggleSleepGuard && toggleSleepGuard.checked);
        out.autoRescue = !!(toggleAutoRescue && toggleAutoRescue.checked);
        return out;
    },
    // 拖拽中的粒子下标（复用数组，不产生垃圾）
    getLocks() {
        lowSpecLockBuf.length = 0;
        for (let i = 0; i < draggedParticles.length; i++) lowSpecLockBuf.push(draggedParticles[i].index);
        if (multiTouchMap.size) {
            for (const data of multiTouchMap.values()) {
                const list = data.dragged;
                for (let i = 0; i < list.length; i++) lowSpecLockBuf.push(list[i].index);
            }
        }
        return lowSpecLockBuf;
    },
    hasLocks() { return draggedParticles.length > 0 || multiTouchMap.size > 0; },
    decorVersion() { return decorations.length; },
    getDecorations() { return decorations; },
    // 自碰撞交给宿主跑（网格构建与排斥计算都留在这边）：
    // 空间网格每帧只建一次，响应遍数由求解器按「碰撞迭代数」滑块决定
    // （经典档每帧 / 低配档隔帧由 profile 决定）。
    // 「碰撞质量档位 = 轻量」时：半径 ×0.6、只跑 1 遍响应，隔帧由求解器负责
    // 「rescue = true」= 卡住自动解缠窗口：半径 ×0.35、只跑 1 遍（平时完全不开销）
    solveCollision(c, lockSet, passes, rescueRadius, pushMul) {
        const light = collisionQualitySelect && collisionQualitySelect.value === "light";
        const rescue = typeof rescueRadius === "number" && rescueRadius > 0;
        const mul = rescue ? rescueRadius : (light ? 0.6 : 1);
        c.buildCollisionGrid(mul);
        const n = rescue ? Math.max(1, passes | 0) : ((light ? 1 : Math.max(1, passes | 0)));
        const push = rescue ? (pushMul || 1) : 1;
        // 解缠窗口里不做"速度注入"（velocity-neutral），只做位置分离：
        // 否则每一次推挤都会额外给质点加速，几十对叠在一起就是"疯狂抽搐"的能量泵。
        for (let i = 0; i < n; i++) c.solveCollision(lockSet, push, rescue);
    },
    afterSolve(c) {
        c.updateGeo();
        if (outlineEnabled && outlineMesh) updateOutlineMesh();
    },
    // 🔍 供求解器的"卡住自动解缠"做拓扑自检：只有在布料静止时才会被调用（每 2 秒一次），
    //    返回三角面互相穿插的对数，>0 才启动解缠。
    countSelfIntersections() {
        return countClothSelfIntersections();
    }
};

// 极弱设备首次打开时自动启用（之后跟随用户的选择，记在 localStorage）
function detectWeakDevice() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 0; // 仅 Chromium 系提供，单位 GB
    return cores <= 2 || (mem > 0 && mem <= 2);
}

function loadLowSpecSetting() {
    try {
        const saved = localStorage.getItem(LOW_SPEC_KEY);
        if (saved === "1") return true;
        if (saved === "0") return false;
    } catch (e) { /* 隐私模式 / 沙盒环境下忽略 */ }
    return detectWeakDevice();
}

// 渲染侧的降档：阴影贴图尺寸 + 阴影过滤方式
function applyLowSpecRenderQuality() {
    if (!renderer) return;
    if (renderer.shadowMap) {
        renderer.shadowMap.type = lowSpecMode ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
        renderer.shadowMap.needsUpdate = true;
    }
    if (dirLight && dirLight.shadow) {
        const size = lowSpecMode ? LOW_SPEC.SHADOW_SIZE : 2048;
        if (dirLight.shadow.mapSize.width !== size) {
            dirLight.shadow.mapSize.set(size, size);
            if (dirLight.shadow.map) {
                dirLight.shadow.map.dispose();
                dirLight.shadow.map = null;
            }
        }
    }
    // 阴影过滤方式变了需要重新编译 shader（只在外层材质上标脏，不递归改贴图）
    if (scene) {
        scene.traverse((obj) => {
            if (!obj.isMesh || !obj.material) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (let i = 0; i < mats.length; i++) {
                if (mats[i]) mats[i].needsUpdate = true;
            }
        });
    }
}

// 当前渲染是否真的用得到顶点法线（纯色 + 无光照 + 无描边/厚度时用不到）
// → 低配模式下这种最常见的情况可以整帧跳过 computeVertexNormals()
function clothNeedsNormals() {
    if (outlineEnabled || thicknessEnabled) return true;
    if (!clothMesh || !clothMesh.material) return true;
    if (!clothMesh.material.isMeshBasicMaterial) return true;   // 受光材质必须有法线
    if (pbrBaseNormalTexture || pbrNoiseNormalTexture) return true;
    if (holoEnabled || (waterEnabled && lightEnabled)) return true;
    return false;
}

// FPS 角标：常驻显示，低配模式开启时额外亮出标签
function updatePerfBadge() {
    if (!lowSpecBadgeEl) return;
    lowSpecBadgeEl.style.display = "inline-flex";
    lowSpecBadgeEl.classList.toggle("classic", !lowSpecMode);
    if (perfModeLabelEl) perfModeLabelEl.style.display = lowSpecMode ? "inline-flex" : "none";
}

function setLowSpecMode(on, opts = {}) {
    on = !!on;
    lowSpecMode = on;

    if (toggleLowSpecEl) toggleLowSpecEl.checked = on;
    updatePerfBadge();
    if (lowSpecFpsEl) lowSpecFpsEl.textContent = "-- FPS";
    lowSpecFpsCount = 0;
    lowSpecFpsTime = 0;

    // 切换后让布料立刻重新解算，避免停在休眠状态
    if (cloth) cloth.wake();

    applyLowSpecRenderQuality();
    resizeCanvas();               // 低配会降低渲染像素比
    if (clothMesh) {
        switchClothMaterial();    // 阴影类型变了，材质需要重新编译
        if (thicknessEnabled) updateThicknessMesh();
    }

    if (!opts.silent) {
        try { localStorage.setItem(LOW_SPEC_KEY, on ? "1" : "0"); } catch (e) { }
    }
}

if (toggleLowSpecEl) {
    toggleLowSpecEl.onchange = () => setLowSpecMode(toggleLowSpecEl.checked);
}

// 任何一次「操作」都顺手唤醒低配求解器：
// 改参数 / 拖拽 / 切割之后都要能立刻看到反应，不能被休眠卡住。
document.addEventListener('pointerdown', () => { if (cloth) cloth.wake(); }, true);
document.addEventListener('keydown', () => { if (cloth) cloth.wake(); }, true);
(function bindLowSpecWakeOnUI() {
    const uiEl = document.getElementById("ui");
    if (!uiEl) return;
    const wake = () => { if (cloth) cloth.wake(); };
    uiEl.addEventListener('input', wake, true);
    uiEl.addEventListener('change', wake, true);
})();

// FPS 计数（角标常驻，两种模式都显示）
let lowSpecFpsCount = 0;
let lowSpecFpsTime = 0;

// ==============================================================
// 🟢 核心重写：引入子步 (Substeps) 来彻底解决抖动和蜷缩
// ==============================================================
class Cloth {
    constructor(bounds, pinStrokes, res) {
        const bWidth = Math.max(0.01, bounds.maxX - bounds.minX);
        const bHeight = Math.max(0.01, bounds.maxY - bounds.minY);
        const targetAspect = imgAspect > 0 ? imgAspect : 1;
        let resX = res;
        let resY = Math.round(res / targetAspect);
        const MAX_RES = 120;
        if (resY > MAX_RES) { resY = MAX_RES; resX = Math.round(resY * targetAspect); }
        else if (resX > MAX_RES) { resX = MAX_RES; resY = Math.round(resX / targetAspect); }
        resX = Math.max(4, resX); resY = Math.max(4, resY);

        this.resX = resX;
        this.resY = resY;

        this.particles = [];
        this.normals = null;
        const grid = [];
        const currentMass = Math.max(0.1, parseFloat(massSlider.value));
        const invMass = 1.0 / currentMass;
        this.baseRestLength = Math.min(bWidth / resX, bHeight / resY);
        let hasUserPins = pinStrokes.length > 0;

        for (let j = 0; j <= resY; j++) {
            grid[j] = [];
            for (let i = 0; i <= resX; i++) {
                const u = i / resX, v = j / resY;
                let px = bounds.minX + bWidth * u;
                let py = bounds.minY + bHeight * v;
                const idx = this.particles.length;
                const shouldPin = hasUserPins ? false : (j === resY);

                // ==========================================================
                // 🧵 出生状态：严格落在静止网格上，初速度保持为 0
                // ----------------------------------------------------------
                // 旧实现把初速度写成「按行 sin(j)、按列 cos(i)」的函数：
                //   initialVx += sin(j*0.6)*0.03   → 每一行整体向左/右滑
                //   initialVy += cos(i*0.6)*0.02   → 每一列整体向上/下滑
                // 这正是一个纯剪切速度场：布料还没开始解算，网格就已经被推成
                // 平行四边形（实测生成后第 1 帧最大剪切角 24°、均值 5.4°），软面料
                // （雪纺/网纱/蕾丝/真丝）剪切刚度低，压不住 → 生成瞬间就是歪的。
                // 现在初速度一律为 0，只保留 ±0.006 的 z 位置抖动（打散对称、不产生宏观形变）。
                const initialVx = 0;
                const initialVy = 0;
                const initialVz = 0;

                const startZ = (Math.random() - 0.5) * 0.012;

                this.particles.push({
                    x: px, y: py, z: startZ,
                    oldX: px - initialVx,
                    oldY: py - initialVy,
                    oldZ: startZ - initialVz,
                    mass: currentMass, invMass: invMass, ix: i, iy: j, pinned: shouldPin, wetness: 0, springs: []
                });
                grid[j][i] = idx;
            }
        }

        this.springs = [];
this.bendSprings = []; // ← 新增：弯曲弹簧
for (let j = 0; j <= resY; j++) {
    for (let i = 0; i <= resX; i++) {
        const idx = grid[j][i];
        if (i + 1 <= resX) this.addSpring(idx, grid[j][i + 1], 'structural', 'h');
        if (j + 1 <= resY) this.addSpring(idx, grid[j + 1][i], 'structural', 'v');
    }
}
for (let j = 0; j < resY; j++) {
    for (let i = 0; i < resX; i++) {
        const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
        this.addSpring(a, d, 'shear', 'd');
        this.addSpring(b, c, 'shear', 'd');
    }
}
// 弯曲弹簧（隔一个格点的约束，只用于抗弯，不参与撕裂）
for (let j = 0; j <= resY; j++) {
    for (let i = 0; i <= resX; i++) {
        const idx = grid[j][i];
        if (i + 2 <= resX) this.addBendSpring(idx, grid[j][i + 2]);
        if (j + 2 <= resY) this.addBendSpring(idx, grid[j + 2][i]);
    }
}
        if (hasUserPins) {
            for (const p of this.particles) {
                for (const strokeObj of pinStrokes) {
                    const stroke = strokeObj.points, lockR = strokeObj.w;
                    for (let s = 0; s < stroke.length - 1; s++) {
                        if (pointSegmentDistance(p.x, p.y, stroke[s].x, stroke[s].y, stroke[s + 1].x, stroke[s + 1].y) < lockR) {
                            p.pinned = true; break;
                        }
                    }
                    if (p.pinned) break;
                }
            }
        }

        const posFlat = [], uvFlat = [], indexList = [];
        for (let j = 0; j <= resY; j++) {
            for (let i = 0; i <= resX; i++) {
                const p = this.particles[grid[j][i]];
                posFlat.push(p.x, p.y, p.z);
                uvFlat.push(i / resX, j / resY);
            }
        }
        for (let j = 0; j < resY; j++) {
            for (let i = 0; i < resX; i++) {
                const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
                indexList.push(a, b, c); indexList.push(b, d, c);
            }
        }
        this.originalIndexList = [...indexList];
        this.cutFaces = new Uint8Array(indexList.length / 3);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(posFlat, 3));
        this.geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvFlat, 2));
        this.geometry.setAttribute("wetness", new THREE.Float32BufferAttribute(new Float32Array(this.particles.length), 1));
        this.geometry.setIndex(new THREE.Uint32BufferAttribute(indexList, 1));
        this.geometry.setAttribute("prevPosition", new THREE.Float32BufferAttribute(posFlat.slice(), 3));

        const nParticles = this.particles.length;
        const thicknessPos = new Float32Array(nParticles * 6);
        this.thicknessGeometry = new THREE.BufferGeometry();
        this.thicknessGeometry.setAttribute("position", new THREE.BufferAttribute(thicknessPos, 3));
        const thicknessUV = new Float32Array(nParticles * 4);
        for (let i = 0; i < nParticles; i++) {
            const u = uvFlat[i * 2], v = uvFlat[i * 2 + 1];
            thicknessUV[i * 2] = u; thicknessUV[i * 2 + 1] = v;
            thicknessUV[(i + nParticles) * 2] = u; thicknessUV[(i + nParticles) * 2 + 1] = v;
        }
        this.thicknessGeometry.setAttribute("uv", new THREE.BufferAttribute(thicknessUV, 2));

        this.originalBottomIndex = [];
        for (let i = 0; i < indexList.length; i += 3) {
            const a = indexList[i] + nParticles, b = indexList[i+1] + nParticles, c = indexList[i+2] + nParticles;
            this.originalBottomIndex.push(a, c, b);
        }
        const boundary = [];
        for (let i = 0; i <= resX; i++) boundary.push(i);
        for (let j = 1; j <= resY; j++) boundary.push(resX + j*(resX+1));
        for (let i = resX - 1; i >= 0; i--) boundary.push(resY*(resX+1) + i);
        for (let j = resY - 1; j > 0; j--) boundary.push(j*(resX+1));

        const edgeIndex = [];
        for (let i = 0; i < boundary.length; i++) {
            const a = boundary[i], b = boundary[(i + 1) % boundary.length];
            edgeIndex.push(a, b, b + nParticles); edgeIndex.push(a, b + nParticles, a + nParticles);
        }
        this.thicknessGeometry.setIndex(new THREE.Uint32BufferAttribute([...this.originalBottomIndex, ...edgeIndex], 1));

        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(currentClothColor), side: THREE.DoubleSide, wireframe: showGrid,
            transparent: false,                 // 先按不透明处理，具体由 updateClothDepthPolicy 决定
            opacity: 1.0,
            depthWrite: true,                   // 必须写深度，否则背面褶皱会透出来
            alphaMap: tearTexture !== null ? tearTexture : pbrAlphaTexture,
            alphaTest: (tearTexture !== null || pbrAlphaTexture !== null) ? 0.05 : 0
        });
        this.mesh = new THREE.Mesh(this.geometry, applyDoubleSide(mat));
        updateClothDepthPolicy(mat);
        // 🎥 3D 视角旋转时布料会转出包围球（包围球是按初始平面算的），
        // 不关掉视锥剔除就会整块突然消失 —— 这就是"转一下面被剔除"的原因
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = shadowEnabled;
        this.mesh.receiveShadow = shadowEnabled;

        this.collisionGrid = new Map();
        // 自碰撞用的锁定标记缓冲（Int8，避免每帧 Set.has）
        this._lockedBuf = new Int8Array(0);
        this._decorIdx = new Int32Array(0);
        this._decorKey = -1;
                // 🟢 新增：碰撞网格复用池，避免每帧新建数组导致GC卡顿
        this.cellPool = [];
        this.cellPoolIndex = 0;
        this.collisionFrameCount = 0;

     // 🟢 新增：碰撞网格复用池，避免每帧新建数组导致GC卡顿
        this.cellPool = [];
        this.cellPoolIndex = 0;
    }

addSpring(i, j, type = 'structural', axis = 'd') {
    const p1 = this.particles[i], p2 = this.particles[j];
    const sIdx = this.springs.length;
    const restLength = Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z);
    this.springs.push({
        i, j,
        restLength,
        originalRestLength: restLength, // ← 新增：塑性恢复基准
        type, axis,                      // ← 新增：弹簧类别
        broken: false
    });

    if (!p1.springs) p1.springs = [];
    if (!p2.springs) p2.springs = [];
    p1.springs.push(sIdx);
    p2.springs.push(sIdx);
}

addBendSpring(i, j) {
    const p1 = this.particles[i], p2 = this.particles[j];
    this.bendSprings.push({
        i, j,
        restLength: Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z),
        broken: false
    });
}

    updateGeo() {
        const arr = this.geometry.attributes.position.array;
        const prev = this.geometry.attributes.prevPosition.array;
        prev.set(arr);
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.prevPosition.needsUpdate = true;

        // 🪶 低配模式：法线降到低频（无光照的纯色材质甚至完全不算）
        const needNormals = !lowSpecMode || this._forceNormals || clothNeedsNormals();
        if (needNormals) {
            this._normalTick = (this._normalTick || 0) + 1;
            const interval = lowSpecMode ? 2 : 1;
            if (this._forceNormals || interval === 1 || this._normalTick >= interval) {
                this._normalTick = 0;
                this._forceNormals = false;
                this.geometry.computeVertexNormals();
                const nArr = this.geometry.attributes.normal.array;
                if (!this.normals) this.normals = new Float32Array(this.particles.length * 3);
                this.normals.set(nArr);
            }
        }

        if (thicknessEnabled && this.thicknessGeometry) {
            // 厚度层需要法线：万一之前被跳过就补算一次
            if (!this.normals) {
                this.geometry.computeVertexNormals();
                this.normals = new Float32Array(this.geometry.attributes.normal.array);
            }
            const normals = this.normals;
            const thick = parseFloat(thicknessSizeSlider.value);
            const tArr = this.thicknessGeometry.attributes.position.array;
            const nParticles = this.particles.length;
            for (let i = 0; i < nParticles; i++) {
                const p = this.particles[i];
                const nx = normals[i*3], ny = normals[i*3+1], nz = normals[i*3+2];
                tArr[i*3] = p.x; tArr[i*3+1] = p.y; tArr[i*3+2] = p.z;
                tArr[(i+nParticles)*3] = p.x - nx * thick;
                tArr[(i+nParticles)*3+1] = p.y - ny * thick;
                tArr[(i+nParticles)*3+2] = p.z - nz * thick;
            }
            this.thicknessGeometry.attributes.position.needsUpdate = true;
            this.thicknessGeometry.computeVertexNormals();
        }
    }

        // 🟢 优化：单独抽出建表步骤，每个子步只建一次
    buildCollisionGrid(radiusMul = 1) {
        const pLen = this.particles.length;
        if (pLen === 0) return;

        // 轻量档会传 0.6 进来：半径更小 → 格子更大 → 邻域里候选点更少，实测便宜一半以上
        // ⚠ 半径硬上限：网格只跳过「自己 ±1 格」的相邻质点，所以半径一旦超过约 2 格距，
        //   连**平整布面上"隔一个格子"的正常邻居**都会被当成重叠互相排斥 ——
        //   整块布会鼓成刺猬、并疯狂抽搐。这里做硬钳位，手动填多大都不会炸。
        const sliderMul = parseFloat(collisionRadiusSlider.value) || 1;
        const wantedMul = sliderMul * (radiusMul > 0 ? radiusMul : 1);
        const baseRadius = this.baseRestLength * Math.min(wantedMul, MAX_COLLISION_RADIUS_MUL);
        // 格子边长取 2.5 倍半径，覆盖 1 圈邻域
        const cellSize = baseRadius * 2.5;
        this._currentBaseRadius = baseRadius;
        this._currentInvCellSize = 1.0 / cellSize;

        // 定长哈希桶（比 Map 快，无 GC）：桶数取 2 的幂，用掩码代替取模
        const BUCKETS = this._collisionBuckets ||
            (this._collisionBuckets = 1 << Math.max(10, Math.min(16, Math.ceil(Math.log2(Math.max(1024, pLen * 4))))));
        const MASK = BUCKETS - 1;

        // 每桶的起始计数 + 链表（single pass：先计数，再填充）
        if (!this._bucketCount || this._bucketCount.length !== BUCKETS) {
            this._bucketCount = new Int32Array(BUCKETS);
            this._bucketHead = new Int32Array(BUCKETS);
            this._next = new Int32Array(pLen);
        }
        const count = this._bucketCount;
        const head = this._bucketHead;
        const next = this._next;
        count.fill(0);
        head.fill(-1);

        const inv = this._currentInvCellSize;
        const cells = this._cellKey || (this._cellKey = new Int32Array(pLen));

        // 第一遍：算格子哈希 + 计数
        for (let i = 0; i < pLen; i++) {
            const p = this.particles[i];
            const cx = Math.floor(p.x * inv);
            const cy = Math.floor(p.y * inv);
            const cz = Math.floor(p.z * inv);
            let h = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
            h &= MASK;
            cells[i] = h;
            next[i] = head[h];
            head[h] = i;
            count[h]++;
        }

        this._currentBucketMask = MASK;
        this._currentBucketHead = head;
        this._currentNext = next;
        this._currentCellKey = cells;
    }

    // 🟢 优化：只负责查表和排斥计算，性能极快
    solveCollision(lockedIndices, pushExtra, velNeutral) {
        const pLen = this.particles.length;
        if (pLen === 0) return;
        const head = this._currentBucketHead;
        if (!head) return;
        const next = this._currentNext;
        const MASK = this._currentBucketMask;
        const inv = this._currentInvCellSize;
        const radiusBase = this._currentBaseRadius;
        const particles = this.particles;
        const pushMul = parseFloat(collisionForceSlider.value) * (pushExtra > 0 ? pushExtra : 1);
        // velNeutral：只做位置分离、不改变速度（解缠窗口用，防止能量越推越大）
        const damping = velNeutral ? 1 : collisionFriction;
        // 每个质点每帧的**位移预算**：不管叠了多少对、半径多大，
        // 单帧被推开的总距离都不会超过这个值 —— 这是"刺猬抽搐"的第二道保险。
        const pushBudget = this.baseRestLength * (velNeutral ? 0.5 : 0.3);
        const used = this._pushUsed && this._pushUsed.length === pLen ? this._pushUsed : (this._pushUsed = new Float32Array(pLen));
        used.fill(0);

        // 装饰物半径倍率缓存（装饰数量变化时才重建）
        const decorKey = decorations.length;
        if (this._decorKey !== decorKey || this._decorIdx.length < pLen) {
            this._decorKey = decorKey;
            this._decorIdx = new Int32Array(pLen);
            for (let d = 0; d < decorations.length; d++) {
                const idx = decorations[d].particleIndex;
                if (idx >= 0 && idx < pLen) this._decorIdx[idx] = decorations[d].weight === 'heavy' ? 2 : 1;
            }
        }
        const decorIdx = this._decorIdx;

        // 锁定标记缓冲
        if (this._lockedBuf.length < pLen) this._lockedBuf = new Int8Array(pLen);
        const locked = this._lockedBuf;
        locked.fill(0, 0, pLen);
        for (const idx of lockedIndices) if (idx >= 0 && idx < pLen) locked[idx] = 1;

        const rMul1 = 1.2, rMul2 = 1.5;

        for (let i = 0; i < pLen; i++) {
            const p1 = particles[i];
            if (p1.pinned || locked[i]) continue;

            const cx = Math.floor(p1.x * inv);
            const cy = Math.floor(p1.y * inv);
            const cz = Math.floor(p1.z * inv);

            const di = decorIdx[i];

            // 自身格 + 6 个相邻格（格子边长 2.5 倍半径，7 格足够覆盖）
            for (let n = 0; n < 7; n++) {
                let hx = cx, hy = cy, hz = cz;
                if (n === 1) hx++;
                else if (n === 2) hx--;
                else if (n === 3) hy++;
                else if (n === 4) hy--;
                else if (n === 5) hz++;
                else if (n === 6) hz--;

                const hash = ((hx * 73856093) ^ (hy * 19349663) ^ (hz * 83492791)) & MASK;
                let j = head[hash];
                while (j !== -1) {
                    if (j > i) {
                        const p2 = particles[j];
                        if (!p2.pinned && !locked[j]) {
                            // 相邻网格点跳过（布料自身缝合）
                            const ax = p1.ix - p2.ix, ay = p1.iy - p2.iy;
                            if (!((ax <= 1 && ax >= -1) && (ay <= 1 && ay >= -1))) {
                                const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
                                const d2 = dx * dx + dy * dy + dz * dz;
                                const dj = decorIdx[j];
                                const rad = (di || dj)
                                    ? radiusBase * (di > dj ? (di === 2 ? rMul2 : rMul1) : (dj === 2 ? rMul2 : rMul1))
                                    : radiusBase;
                                if (d2 < rad * rad) {
                                    const d = Math.sqrt(d2) || 0.001;
                                    const ndx = dx / d, ndy = dy / d, ndz = dz / d;
                                    const overlap = rad - d;
                                    const push = (overlap < rad * 0.5 ? overlap : rad * 0.5) * pushMul;
                                    const w1 = p1.invMass, w2 = p2.invMass;
                                    const wSum = w1 + w2;
                                    if (wSum > 0) {
                                        let m1 = push * (w1 / wSum), m2 = push * (w2 / wSum);
                                        // 位移预算：本帧已推开多少就扣多少，用完就停 ——
                                        // 这样"叠了几十对"也不会把质点一帧推出好几格（刺猬抽搐的根因）
                                        const room1 = pushBudget - used[i];
                                        const room2 = pushBudget - used[j];
                                        if (m1 > room1) m1 = room1 > 0 ? room1 : 0;
                                        if (m2 > room2) m2 = room2 > 0 ? room2 : 0;
                                        if (m1 > 0 || m2 > 0) {
                                            used[i] += m1; used[j] += m2;
                                            p1.x -= ndx * m1; p1.y -= ndy * m1; p1.z -= ndz * m1;
                                            p2.x += ndx * m2; p2.y += ndy * m2; p2.z += ndz * m2;
                                            p1.oldX -= ndx * m1 * damping; p1.oldY -= ndy * m1 * damping; p1.oldZ -= ndz * m1 * damping;
                                            p2.oldX += ndx * m2 * damping; p2.oldY += ndy * m2 * damping; p2.oldZ += ndz * m2 * damping;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    j = next[j];
                }
            }
        }
        this.collisionFrameCount++;
    }

    // 🪶 唤醒求解器（切换模式 / 改参数 / 继续解算时调用）
    wake() {
        if (this._solver) this._solver.wake();
    }

    /** 求解器诊断快照（性能角标 / 排查用）：asleep、passes、maxViol、effStiff… */
    solverStats() {
        return this._solver ? this._solver.stats : null;
    }

    // ==========================================================
    // 🧵 解算入口：经典模式与低配模式共用 physics-lowspec.js 的求解器
    // ----------------------------------------------------------
    // 以前这里有一份独立的「经典」热循环，和低配求解器各写一遍。
    // 那份循环里有几处很贵的写法，现在都被统一求解器取代：
    //   · 每个质点、每个子步都算一次 Math.pow(massRatio, airExp) → 整帧只算一次
    //   · 每根弹簧、每遍迭代都做 Math.hypot + lockedIndices.has()
    //     → 改成手写 sqrt + 每帧预计算的权重数组
    //   · 风的 6 次 sin + 6 次 cos 逐质点逐子步 → 1024 项正弦查表
    //   · 每帧新建装饰重力 Float32Array → 复用同一块内存
    //   · 迭代次数永远跑满 → 残差足够小就提前收工（Blender 的误差阈值思路）
    // 两种模式只靠质量档位区分：
    //   经典 = 迭代上限 20 / 自碰撞每帧 / 单步预算 6.0ms
    //   低配 = 迭代上限 10 / 自碰撞隔帧 / 单步预算 3.5ms
    // ==========================================================
    simulate(dt) {
        if (!this._solver) {
            this._solver = new ClothSolver({ cloth: this, host: clothSolverHost });
            // 新布料第一次解算：把用户当前的「形状缩放因子」补上（不重置他的设置）
            const want = Number.isFinite(this._wantShape) ? this._wantShape : shapeFactor;
            if (Number.isFinite(want) && want !== 0) this._solver.setShapeScale(want);
        }
        this._solver.setProfile(lowSpecMode ? SOLVER_PROFILES.lowSpec : SOLVER_PROFILES.normal);
        this._solver.simulate(dt);
    }
}

document.getElementById("genBtn").onclick = () => {
    if (!loadedImage) { alert(window.I18N[window.currentLang].alert_no_img); return; }
    // 🧵 只有第一次生成（还没动过网格密度）才跟随预设；之后一律以用户滑块为准，不再被重置
    const presetKey = physicsPresetSelect.value;
    const presetForMesh = physicsPresets[presetKey];
    if (!userTouchedMeshRes && presetKey !== "custom" && presetForMesh && presetForMesh.meshRes) {
        meshResSlider.value = presetForMesh.meshRes;
        document.getElementById("meshResValue").textContent = presetForMesh.meshRes;
    }
    destroyCloth();
    // 🪶 低配模式：网格分辨率限幅（顶点数直接决定解算量）
    const rawRes = parseInt(meshResSlider.value);
    const meshRes = lowSpecMode ? Math.min(rawRes, LOW_SPEC.MAX_RES) : rawRes;
    let maxW = BOUND_SCALE * 2 * 0.95;
    let maxH = maxW;
    if (imgAspect >= 1) maxH = maxW / imgAspect; else maxW = maxH * imgAspect;
    const bounds = { minX: -maxW / 2, maxX: maxW / 2, minY: -maxH / 2, maxY: maxH / 2 };

    cloth = new Cloth(bounds, pinStrokeList, meshRes);
    // 重新生成时保留用户当前的形状缩放因子（滑块不动、布也直接是缩放后的尺寸）
    cloth._wantShape = shapeFactor;
    clothMesh = cloth.mesh;
    (sceneHolder || scene).add(clothMesh);

    // ✅ 修复：装饰物坐标映射（解决上下颠倒问题）
    for (const d of decorPlacementList) {
        let u = (d.x - bounds.minX) / (bounds.maxX - bounds.minX);
        let v = (d.y - bounds.minY) / (bounds.maxY - bounds.minY); // 物理Y轴向上，映射到网格的j轴
        let ix = Math.max(0, Math.min(cloth.resX, Math.round(u * cloth.resX)));
        let iy = Math.max(0, Math.min(cloth.resY, Math.round(v * cloth.resY)));
        const pIndex = iy * (cloth.resX + 1) + ix;

        const mesh = create3DDecorMesh(d.type, d.color, d.mat, d.size);
        scene.add(mesh);
        decorations.push({
            mesh: mesh,
            particleIndex: pIndex,
            radius: mesh.userData.radius,
            weight: d.weight
        });
    }

    undoStack = []; redoStack = [];
    if (!velocityMat) velocityMat = createVelocityMaterial();
    velocityMesh = new THREE.Mesh(cloth.geometry, velocityMat);
    velocityMesh.frustumCulled = false;
    velocityScene.add(velocityMesh);
    switchClothMaterial();
    if (outlineEnabled) updateOutlineMesh();
    if (thicknessEnabled) updateThicknessMesh();

    toggleTex.checked = textureEnabled; toggleLight.checked = lightEnabled; toggleShadow.checked = shadowEnabled;
    toggleCollision.checked = collisionEnabled; toggleOutline.checked = outlineEnabled; toggleGrid.checked = showGrid;
    toggleThickness.checked = thicknessEnabled; toggleThicknessTex.checked = thicknessTexEnabled;
    thicknessCtrl.style.display = thicknessEnabled ? "block" : "none";
    thicknessTexCtrl.style.display = thicknessEnabled ? "grid" : "none";
    thicknessColorCtrl.style.display = (thicknessEnabled && !thicknessTexEnabled) ? "block" : "none";

    setEditMode(false);
    hasGeneratedOnce = true;   // 生成过一次后就不再弹第二步引导
    if (!isSimulating) pauseBtn.click();
    // 🧵 旋转清零后，再按当前预设套用默认悬挂角度
    prevRotX = 0; prevRotY = 0; prevRotZ = 0;
    if (rotXSlider) { rotXSlider.value = 0; rotXValue.textContent = "0°"; }
    if (rotYSlider) { rotYSlider.value = 0; rotYValue.textContent = "0°"; }
    if (rotZSlider) { rotZSlider.value = 0; rotZValue.textContent = "0°"; }
    applyRestPose(physicsPresetSelect.value);
};

// ==============================================================
// 🧷 快速固定（Quick Pinning）
// 一键铺好固定点：上边整条 / 上边 2~5 点 / 四角 / 四周全框 / 左右两点 / 清除
// 另外提供「解算时可拖动固定点」，拖动时改变两点间距，布料会实时跟着走。
// ==============================================================
let pinDragEnabled = false;      // 解算时是否允许拖动固定点
let draggingPins = false;        // 当前这次拖拽是不是在拖固定点

// 画布 UV → 布料世界坐标（与 getPreviewPointer 里的映射完全一致）
function pinUvToWorld(u, v) {
    let maxW = BOUND_SCALE * 2 * 0.95;
    let maxH = maxW;
    if (imgAspect >= 1) maxH = maxW / imgAspect;
    else maxW = maxH * imgAspect;
    return { x: u * maxW - maxW / 2, y: maxH / 2 - v * maxH, u, v };
}

// 一条固定线段（uv 坐标，v=0 是上边）
function pinEdgeStroke(u1, v1, u2, v2, w) {
    const a = pinUvToWorld(u1, v1);
    const b = pinUvToWorld(u2, v2);
    return { points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], w: w };
}

// 一个"点"固定（用极短线段 + 稍大的半径，能钉住一小撮粒子）
function pinDotStroke(u, v, w) {
    const r = Math.max(w, 0.06);
    return pinEdgeStroke(u, v, u + 0.0015, v, r);
}

const QUICK_PIN_PATTERNS = {
    top:    (w) => [pinEdgeStroke(0, 0, 1, 0, w)],
    // 2/3/5 点都从贴图的两个上角开始，再向内均分（N 点 = N 等分的顶点）
    top2:   (w) => [pinDotStroke(0, 0, w), pinDotStroke(1, 0, w)],
    top3:   (w) => [pinDotStroke(0, 0, w), pinDotStroke(0.5, 0, w), pinDotStroke(1, 0, w)],
    top5:   (w) => [0, 0.25, 0.5, 0.75, 1].map(u => pinDotStroke(u, 0, w)),
    corners:(w) => [pinDotStroke(0, 0, w), pinDotStroke(1, 0, w), pinDotStroke(0, 1, w), pinDotStroke(1, 1, w)],
    frame:  (w) => [
        pinEdgeStroke(0, 0, 1, 0, w),
        pinEdgeStroke(0, 1, 1, 1, w),
        pinEdgeStroke(0, 0, 0, 1, w),
        pinEdgeStroke(1, 0, 1, 1, w)
    ],
    sides:  (w) => [pinDotStroke(0, 0.5, w), pinDotStroke(1, 0.5, w)],
    clear:  () => []
};

function applyQuickPin(key) {
    if (!loadedImage) {
        alert(window.I18N[window.currentLang].alert_no_img);
        return;
    }
    const build = QUICK_PIN_PATTERNS[key];
    if (!build) return;

    saveHistory();
    const w = Math.max(0.02, parseFloat(pinRadiusSlider.value) || 0.04);
    pinStrokeList = build(w);
    currentPinStroke = [];
    redrawPreview();

    // 固定点是"生成布料"时参与的属性：已经有布料就按新固定方式重算一次
    if (cloth) {
        const genBtnEl = document.getElementById("genBtn");
        if (genBtnEl) genBtnEl.click();
    } else {
        updateEmptyGuide();
    }
}

(function bindQuickPinUI() {
    const btns = document.querySelectorAll(".quick-pin-btn");
    for (const btn of btns) {
        btn.onclick = () => {
            for (const b of btns) b.classList.remove("active");
            btn.classList.add("active");
            applyQuickPin(btn.dataset.quickpin);
        };
    }
    const toggle = document.getElementById("togglePinDrag");
    if (toggle) {
        toggle.onchange = () => {
            pinDragEnabled = toggle.checked;
            if (!pinDragEnabled) { draggingPins = false; draggedParticles = []; }
            if (typeof updatePinDots === "function") updatePinDots();
            // 两个拖拽模式互斥：要拖固定点时自动关掉 3D 镜头，避免抢手势
            if (pinDragEnabled && typeof cam3DEnabled !== "undefined" && cam3DEnabled) {
                cam3DEnabled = false;
                const camToggle = document.getElementById("toggleCam3D");
                if (camToggle) camToggle.checked = false;
            }
        };
    }
})();


function setEditMode(on) {
    editMode = on;
    previewCanvas.style.display = on ? "block" : "none";
    document.getElementById("backToEditBtn").style.display = on ? "none" : "block";
    if (!on) {
        isDrawing = false; isCutting = false;
        if (typeof endDrag === "function") endDrag();
        multiTouchMap.clear();
    }
    updateEmptyGuide();
}

// ==============================================================
// 🪶 空白区引导：没图片时引导上传，有图片时引导"画固定区域 → 生成布料"
// ==============================================================
function updateEmptyGuide() {
    const guide = document.getElementById("emptyGuide");
    if (!guide) return;
    const stepUpload = document.getElementById("guideStepUpload");
    const stepPin = document.getElementById("guideStepPin");

    // 有布料（进入解算/交互状态）就不用引导了
    const show = editMode && !cloth;
    guide.style.display = show ? "block" : "none";
    if (!show) return;

    const noImage = !loadedImage;
    // 第二步只在"有图、还没画固定线、并且这次会话还没生成过布料"时出现，
    // 避免打扰已经会用的用户。
    const showPin = !noImage && !hasGeneratedOnce && pinStrokeList.length === 0;
    if (stepUpload) stepUpload.style.display = noImage ? "block" : "none";
    if (stepPin) stepPin.style.display = showPin ? "flex" : "none";
}

(function bindEmptyGuide() {
    const uploadBtn = document.getElementById("guideUploadBtn");
    if (uploadBtn) uploadBtn.onclick = () => document.getElementById("fileInput").click();
    const genBtn = document.getElementById("guideGenBtn");
    if (genBtn) genBtn.onclick = () => document.getElementById("genBtn").click();
})();

document.getElementById("backToEditBtn").onclick = () => { destroyCloth(); setEditMode(true); };
document.getElementById("clearStrokeBtn").onclick = () => { saveHistory(); pinStrokeList = []; currentPinStroke = []; redrawPreview(); };

document.getElementById("resetBtn").onclick = () => {
    if (!confirm(window.I18N[window.currentLang].reset_confirm)) return;
    destroyCloth();
    pinStrokeList = []; currentPinStroke = []; decorPlacementList = [];
    clearSelection();
    textureFilterSelect.value = "none";
    currentFilterType = "none";
    loadedImage = null; imageTexture = null; textureEnabled = false; lightEnabled = false;
    shadowEnabled = false; collisionEnabled = false; outlineEnabled = false; thicknessEnabled = false; showGrid = false;
    flipH = false; flipV = false;
    currentClothColor = "#9BCDEC"; clothColorInput.value = "#9BCDEC";
    if (ambientLight) ambientLight.visible = false;
    if (dirLight) dirLight.visible = false;
    if (groundMesh) groundMesh.visible = false;
    if (groundShadowMesh) groundShadowMesh.visible = false;
    if (backWallMesh) backWallMesh.visible = false;
    toggleTex.checked = false; toggleLight.checked = false; toggleShadow.checked = false;
    toggleCollision.checked = false; toggleOutline.checked = false; toggleGrid.checked = false; toggleThickness.checked = false;
    roughnessSlider.value = 0.75; metalnessSlider.value = 0.5; opacitySlider.value = 1.0;
    clothOpacity = 1.0; flatShadingEnabled = false; toggleFlat.checked = false;
    document.getElementById("roughnessValue").textContent = "0.75";
    document.getElementById("metalnessValue").textContent = "0.50";
    document.getElementById("opacityValue").textContent = "1.00";
    toggleBlur.checked = false; blurEnabled = false; blurCtrl.style.display = "none";
    thicknessCtrl.style.display = "none"; thicknessTexCtrl.style.display = "none"; thicknessColorCtrl.style.display = "none";
    toggleThicknessTex.checked = false; thicknessTexEnabled = false;
    windNoiseAmpSlider.value = 0.40; windRandomSlider.value = 0.50; windSpeedSlider.value = 1.60;
    outlineThickSlider.value = 0.008; outlineColorInput.value = "#000000";
    massSlider.value = 25.0; windSlider.value = 0.3; windDirSlider.value = 0;

    windPresetSelect.value = "custom"; toggleWind.checked = false; windEnabled = false;

    zoomSlider.value = 1;
    document.getElementById("zoomValue").textContent = "1.00";
    camXSlider.value = 0;
    document.getElementById("camXValue").textContent = "0.00";
    camYSlider.value = 0;
    document.getElementById("camYValue").textContent = "0.00";
    maxStretchSlider.value = 1.5;
    document.getElementById("maxStretchValue").textContent = "1.5";
    dampingSlider.value = 0.07;
    document.getElementById("dampingValue").textContent = "0.07";
    document.getElementById("constraintIterations").value = 6;
    document.getElementById("constraintIterationsValue").textContent = "6";
    document.getElementById("physicsHz").value = 100;
    document.getElementById("physicsHzValue").textContent = "100";
    maxDragDistanceSlider.value = 0.6;
    document.getElementById("maxDragDistanceValue").textContent = "0.60";

    document.querySelector('input[name="dragModeRadio"][value="single"]').checked = true;
    dragMode = "single"; dragRadiusCtrl.style.display = "none";
    if (maxDragDistanceCtrl) maxDragDistanceCtrl.style.display = "grid";

    tearThresholdSlider.value = 1.2;
    document.getElementById("tearThresholdValue").textContent = "1.20";
    tearPresetSelect.value = "normal";
    if (tearSettingsGroup) tearSettingsGroup.style.display = "none";

    if (tearCtx) {
        tearCtx.fillStyle = '#ffffff';
        tearCtx.fillRect(0, 0, tearCanvas.width, tearCanvas.height);
        if (tearTexture) tearTexture.needsUpdate = true;
    }

    eraserModeSelect.value = "whole"; eraserMode = "whole"; eraserModeCtrl.style.display = "none";
    knifeRadiusSlider.value = 0.05;
    document.getElementById("knifeRadiusValue").textContent = "0.05";
    knifeRadiusCtrl.style.display = "none";
    setDrawMode("pinstroke");
    physicsPresetSelect.value = "cotton"; materialPresetSelect.value = "default";
    meshResSlider.value = 24;
    document.getElementById("meshResValue").textContent = "24";
    document.getElementById("windDirValue").textContent = "0°";
    pbrTextureSelect.value = "none"; currentPbrType = "none";
    if (pbrCustomNormalTexture) pbrCustomNormalTexture.dispose();
    pbrCustomNormalTexture = null;
    customNormalCtrl.style.display = "none"; customNormalInput.value = "";
    togglePbrNoise.checked = false; pbrNoiseEnabled = false;
    pbrNoiseCtrl.style.display = "none"; pbrNoiseIntensityCtrl.style.display = "none"; pbrNoiseSizeCtrl.style.display = "none";
    pbrNoiseStyleSelect.value = "sand"; pbrNoiseIntensitySlider.value = 0.5; pbrNoiseIntensity = 0.5;
    pbrNoiseSizeSlider.value = 4; pbrNoiseSize = 4.0;
    document.getElementById("pbrNoiseSizeValue").textContent = "4";
    pbrTexSizeCtrl.style.display = "none"; pbrNormalScaleCtrl.style.display = "none";
    pbrNormalScaleSlider.value = 1.0; pbrNormalScale = 1.0;
    document.getElementById("pbrNormalScaleValue").textContent = "1.0";
    updatePbrTextures();
    lightXSlider.value = 2; lightYSlider.value = 4.5; lightZSlider.value = 5;
    lightColorInput.value = "#ffffff";
    updateLightPosition();
    waterEnabled = false; clothWetness = 0; lastWetnessPercent = -1;
    if (wetnessValueEl) wetnessValueEl.textContent = "0.0%";
    evapSpeedSlider.value = 0.002; evaporationSpeed = 0.002;
    document.getElementById("evapSpeedValue").textContent = "0.0020";
    waterDropSizeSlider.value = 1.0; waterDropSize = 1.0;
    waterDropSizeValueEl.textContent = "1.0";
    waterDropDensitySlider.value = 1.0; waterDropDensity = 1.0;
    waterDropDensityValueEl.textContent = "1.0";
    waterNormalIntensitySlider.value = 1.0; waterNormalIntensity = 1.0;
    waterNormalIntensityValueEl.textContent = "1.0";
    collisionRadiusSlider.value = 0.9;
    collisionForceSlider.value = 0.8;
    collisionItersSlider.value = 2;
    document.getElementById("collisionRadiusValue").textContent = "0.90";
    document.getElementById("collisionForceValue").textContent = "0.8";
    document.getElementById("collisionItersValue").textContent = "2";
    collisionPresetSelect.value = "balance";
    resetBgBtn.click();
    document.getElementById("fileInput").value = "";
    textureFilterSelect.value = "none";
    currentFilterType = "none";
    filterStrengthSlider.value = 1.0;
    currentFilterStrength = 1.0;
    filterStrengthValue.textContent = "0.30";
    filterStrengthCtrl.style.display = "none";
    toggleHolo.checked = false;
    holoEnabled = false;
    holoIntensitySlider.value = 0.8;
    holoIntensityValue.textContent = "0.80";
    holoIntensityCtrl.style.display = "none";
    toggleHolo.checked = false;
    holoEnabled = false;
    filterStrengthSlider.value = 0.3;
    currentFilterStrength = 0.3;
    filterStrengthValue.textContent = "0.30";
    togglePlasticity.checked = false; plasticityEnabled = false;
document.getElementById("plasticityRate").value = 0.05; plasticityRate = 0.05;
document.getElementById("plasticityThreshold").value = 1.05; plasticityThreshold = 1.05;
document.getElementById("plasticityRecovery").value = 0; plasticityRecovery = 0;
document.getElementById("plasticityMax").value = 3.0; plasticityMax = 3.0;
document.getElementById("bendStiffness").value = 0.1; bendStiffness = 0.1;
document.getElementById("shearStiffness").value = 1.0; shearStiffness = 1.0;
document.getElementById("stiffX").value = 1.0; stiffX = 1.0;
document.getElementById("stiffY").value = 1.0; stiffY = 1.0;
document.getElementById("springDamping").value = 0; springDamping = 0;
document.getElementById("windSpatialFreq").value = 4; windSpatialFreq = 4;
document.getElementById("windZ").value = 0; windZ = 0;
document.getElementById("gravityAngle").value = 0; gravityAngle = 0;
document.getElementById("toggleGround").checked = true; groundCollisionEnabled = true;
    // 🟫 地面显示开关也回到默认（关）
    groundVisible = false;
    const groundShowToggle = document.getElementById("toggleGroundShow");
    if (groundShowToggle) groundShowToggle.checked = false;
    updateGroundDisplay();
document.getElementById("groundY").value = -1.5; groundY = -1.5;
document.getElementById("groundFriction").value = 0.8; groundFriction = 0.8;
document.getElementById("collisionFriction").value = 0.6; collisionFriction = 0.6;
document.getElementById("dragStrength").value = 0.4; dragStrength = 0.4;
document.getElementById("airDampingExp").value = 0.2; airDampingExp = 0.2;
document.getElementById("maxVelocity").value = 0.2; maxVelocity = 0.2;
document.getElementById("velocityRetention").value = 1.0; velocityRetention = 1.0;
    // 「重置全部」是显式的全量复原：形状缩放因子也回 0
    // （和「生成布料」不同 —— 那边会保留用户当前的因子）
    shapeFactor = 0;
    if (typeof syncShapeSliderFromState === "function") syncShapeSliderFromState();
    if (rotXSlider) { rotXSlider.value = 0; rotXValue.textContent = "0°"; prevRotX = 0; }
    if (rotZSlider) { rotZSlider.value = 0; rotZValue.textContent = "0°"; prevRotZ = 0; }
    if (resetRotBtn) resetRotBtn.click();

    if (dragDepthSelect) {
        dragDepthSelect.value = "auto";
        dragDepthMode = "auto";
    }

    setEditMode(true);
    redrawPreview();
    updateCamera();
    // 重置扩展物理参数为「棉」预设
applyPresetToSliders(physicsPresets.cotton);
physicsPresetSelect.value = "cotton";
};

function bindSlider(id, valueId, callback, format = (v) => parseFloat(v).toFixed(2)) {
    const slider = document.getElementById(id);
    const display = document.getElementById(valueId);
    if (!slider || !display) return;
    slider.oninput = () => {
        display.textContent = format(slider.value);
        if (callback) callback(parseFloat(slider.value));
    };
}

function bindToggle(id, callback) {
    const el = document.getElementById(id);
    if (el) el.onchange = () => callback(el.checked);
}

bindSlider("zoom", "zoomValue", updateCamera);
bindSlider("camX", "camXValue", updateCamera);
bindSlider("camY", "camYValue", updateCamera);
bindSlider("pinRadius", "pinRadiusValue", redrawPreview, (v) => parseFloat(v).toFixed(3));
bindSlider("simMult", "simMultValue", null, (v) => parseFloat(v).toFixed(2));
bindSlider("meshRes", "meshResValue", null, (v) => parseInt(v));

// 🫨 抖动力度 / 时长：只影响下一次点「抖一抖」的冲量，不打断当前解算
bindSlider("shakeAmp", "shakeAmpValue", (v) => { if (SHAKE) SHAKE.amp = v; }, (v) => parseFloat(v).toFixed(1));
bindSlider("shakeFrames", "shakeFramesValue", (v) => { if (SHAKE) SHAKE.frames = v; }, (v) => parseInt(v));

// 🔻 形状缩放因子：实时改变所有静止长度（负=收紧起皱 / 正=松弛鼓胀）
bindSlider("shapeScale", "shapeScaleValue", (v) => {
    shapeFactor = Number.isFinite(v) ? v : 0;
    applyShapeScale();
}, (v) => parseFloat(v).toFixed(3));
// 用户一旦手动调过网格密度，后续生成就不再被预设覆盖
if (meshResSlider) meshResSlider.addEventListener("input", () => { userTouchedMeshRes = true; });
if (meshResSlider) meshResSlider.addEventListener("change", () => { userTouchedMeshRes = true; });
bindSlider("knifeRadius", "knifeRadiusValue", null, (v) => parseFloat(v).toFixed(3));
bindSlider("dragRadius", "dragRadiusValue", null, (v) => parseFloat(v).toFixed(2));
bindSlider("maxDragDistance", "maxDragDistanceValue", null, (v) => parseFloat(v).toFixed(2));

bindSlider("stiffness", "stiffnessValue", null);
bindSlider("maxStretch", "maxStretchValue", null, (v) => parseFloat(v).toFixed(1));
bindSlider("damping", "dampingValue", null);
bindSlider("gravity", "gravityValue", null);
bindSlider("mass", "massValue", null, (v) => parseFloat(v).toFixed(1));
bindSlider("constraintIterations", "constraintIterationsValue", null, (v) => parseInt(v));
bindSlider("physicsHz", "physicsHzValue", () => { accumulator = 0; }, (v) => parseInt(v));

bindSlider("wind", "windValue", null);
bindSlider("windDir", "windDirValue", null, (v) => parseInt(v) + "°");
bindSlider("windNoiseAmp", "windNoiseAmpValue", null);
bindSlider("windRandom", "windRandomValue", null);
bindSlider("windSpeed", "windSpeedValue", null);

bindSlider("lightIntensity", "lightIntensityValue", (v) => {
    if (dirLight && lightEnabled) dirLight.intensity = v;
});
bindSlider("roughness", "roughnessValue", applyMaterialProps, (v) => parseFloat(v).toFixed(2));
bindSlider("metalness", "metalnessValue", applyMaterialProps, (v) => parseFloat(v).toFixed(2));
bindSlider("opacity", "opacityValue", (v) => { clothOpacity = v; applyMaterialProps(); }, (v) => parseFloat(v).toFixed(2));
bindSlider("lightX", "lightXValue", updateLightPosition, (v) => parseFloat(v).toFixed(1));
bindSlider("lightY", "lightYValue", updateLightPosition, (v) => parseFloat(v).toFixed(1));
bindSlider("lightZ", "lightZValue", updateLightPosition, (v) => parseFloat(v).toFixed(1));

bindSlider("blurStrength", "blurStrengthValue", null);
bindSlider("thicknessSize", "thicknessSizeValue", null, (v) => parseFloat(v).toFixed(3));
bindSlider("outlineThick", "outlineThickValue", updateOutlineMesh, (v) => parseFloat(v).toFixed(3));
bindSlider("evapSpeed", "evapSpeedValue", (v) => { evaporationSpeed = v; }, (v) => parseFloat(v).toFixed(4));

bindSlider("pbrTextureSize", "pbrTexSizeValue", (v) => { pbrTexSize = v; applyPbrRepeat(); }, (v) => parseInt(v));
bindSlider("pbrNormalScale", "pbrNormalScaleValue", (v) => { pbrNormalScale = v; applyMaterialProps(); if (thicknessEnabled) updateThicknessMesh(); }, (v) => parseFloat(v).toFixed(1));
bindSlider("pbrNoiseIntensity", "pbrNoiseIntensityValue", (v) => { pbrNoiseIntensity = v; if (activeShaderRef && activeShaderRef.uniforms.uNoiseIntensity) activeShaderRef.uniforms.uNoiseIntensity.value = v; }, (v) => parseFloat(v).toFixed(2));
bindSlider("pbrNoiseSize", "pbrNoiseSizeValue", (v) => { pbrNoiseSize = v; applyPbrRepeat(); }, (v) => parseInt(v));
bindSlider("toonSteps", "toonStepsValue", () => { if (clothMesh) switchClothMaterial(); }, (v) => parseInt(v));
bindSlider("holoIntensity", "holoIntensityValue", (v) => { if (clothMesh && holoEnabled && activeShaderRef && activeShaderRef.uniforms.uHoloIntensity) activeShaderRef.uniforms.uHoloIntensity.value = v; }, (v) => parseFloat(v).toFixed(2));
bindSlider("waterDropSize", "waterDropSizeValue", (v) => { waterDropSize = v; scheduleRegenerateWaterTexture(); }, (v) => parseFloat(v).toFixed(1));
bindSlider("waterDropDensity", "waterDropDensityValue", (v) => { waterDropDensity = v; scheduleRegenerateWaterTexture(); }, (v) => parseFloat(v).toFixed(1));
bindSlider("waterNormalIntensity", "waterNormalIntensityValue", (v) => { waterNormalIntensity = v; if (activeShaderRef && activeShaderRef.uniforms.uWaterIntensity) activeShaderRef.uniforms.uWaterIntensity.value = v; }, (v) => parseFloat(v).toFixed(1));

bindSlider("collisionRadius", "collisionRadiusValue", () => { collisionPresetSelect.value = "custom"; }, (v) => parseFloat(v).toFixed(2));
bindSlider("collisionForce", "collisionForceValue", () => { collisionPresetSelect.value = "custom"; }, (v) => parseFloat(v).toFixed(1));
bindSlider("collisionIters", "collisionItersValue", () => { collisionPresetSelect.value = "custom"; }, (v) => parseInt(v));
// 辅助：拖动即把预设归为自定义
bindSlider("matTransmission", "matTransmissionValue", (v) => { clothTransmission = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matClearcoat", "matClearcoatValue", (v) => { clothClearcoat = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matIor", "matIorValue", (v) => { clothIor = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matThickness", "matThicknessValue", (v) => { clothThickness = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matAttenuation", "matAttenuationValue", (v) => { clothAttenuation = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matIridescence", "matIridescenceValue", (v) => { clothIridescence = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matIridescenceIor", "matIridescenceIorValue", (v) => { clothIridescenceIor = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matSheen", "matSheenValue", (v) => { clothSheen = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });
bindSlider("matSheenRoughness", "matSheenRoughnessValue", (v) => { clothSheenRoughness = v; applyMaterialProps(); if (clothMesh) switchClothMaterial(); });

document.getElementById("matAttenuationColor").oninput = (e) => { clothAttenuationColor = e.target.value; applyMaterialProps(); if (clothMesh) switchClothMaterial(); };
document.getElementById("matSheenColor").oninput = (e) => { clothSheenColor = e.target.value; applyMaterialProps(); if (clothMesh) switchClothMaterial(); };
function bindPhysSlider(id, valId, setter, fmt) {
    bindSlider(id, valId, (v) => {
        setter(v);
        if (physicsPresetSelect) physicsPresetSelect.value = "custom";
    }, fmt);
}

bindPhysSlider("plasticityRate",      "plasticityRateValue",      v => plasticityRate = v);
bindPhysSlider("plasticityThreshold", "plasticityThresholdValue", v => plasticityThreshold = v);
bindPhysSlider("plasticityRecovery",  "plasticityRecoveryValue",  v => plasticityRecovery = v, v => parseFloat(v).toFixed(3));
bindPhysSlider("plasticityMax",       "plasticityMaxValue",       v => plasticityMax = v, v => parseFloat(v).toFixed(1));
bindPhysSlider("bendStiffness",       "bendStiffnessValue",       v => bendStiffness = v);
bindPhysSlider("shearStiffness",      "shearStiffnessValue",      v => shearStiffness = v);
bindPhysSlider("stiffX",              "stiffXValue",              v => stiffX = v);
bindPhysSlider("stiffY",              "stiffYValue",              v => stiffY = v);
bindPhysSlider("springDamping",       "springDampingValue",       v => springDamping = v);
bindPhysSlider("windSpatialFreq",     "windSpatialFreqValue",     v => windSpatialFreq = v, v => parseFloat(v).toFixed(1));
bindPhysSlider("windZ",               "windZValue",               v => windZ = v);
bindPhysSlider("gravityAngle",        "gravityAngleValue",        v => gravityAngle = v, v => parseInt(v) + "°");
bindPhysSlider("groundY",             "groundYValue",             v => { groundY = v; updateGroundDisplay(); });
bindPhysSlider("groundFriction",      "groundFrictionValue",      v => groundFriction = v);
bindPhysSlider("collisionFriction",   "collisionFrictionValue",   v => collisionFriction = v);
bindPhysSlider("dragStrength",        "dragStrengthValue",        v => dragStrength = v);
bindPhysSlider("airDampingExp",       "airDampingExpValue",       v => airDampingExp = v);
bindPhysSlider("maxVelocity",         "maxVelocityValue",         v => maxVelocity = v);
bindPhysSlider("velocityRetention",   "velocityRetentionValue",   v => velocityRetention = v, v => parseFloat(v).toFixed(3));

// 开关类
bindToggle("togglePlasticity", (c) => { plasticityEnabled = c; physicsPresetSelect.value = "custom"; });
bindToggle("toggleGround",     (c) => { groundCollisionEnabled = c; physicsPresetSelect.value = "custom"; });

bindToggle("togglePlasticity", (checked) => plasticityEnabled = checked);
bindToggle("toggleGround", (checked) => groundCollisionEnabled = checked);
let filterDebounceTimer = null;
if (filterStrengthSlider) {
    filterStrengthSlider.oninput = () => {
        currentFilterStrength = parseFloat(filterStrengthSlider.value);
        filterStrengthValue.textContent = currentFilterStrength.toFixed(2);
        if (filterDebounceTimer) clearTimeout(filterDebounceTimer);
        filterDebounceTimer = setTimeout(() => {
            if (loadedImage && currentFilterType !== "none") {
                refreshImageTexture();
                if (clothMesh) switchClothMaterial();
                if (thicknessEnabled) updateThicknessMesh();
            }
        }, 150);
    };
}

textureFilterSelect.onchange = () => {
    currentFilterType = textureFilterSelect.value;
    filterStrengthCtrl.style.display = currentFilterType === "none" ? "none" : "grid";
    if (loadedImage) {
        refreshImageTexture();
        if (clothMesh) switchClothMaterial();
        if (thicknessEnabled) updateThicknessMesh();
    }
};

toggleHolo.onchange = () => {
    holoEnabled = toggleHolo.checked;
    if (holoIntensityCtrl) holoIntensityCtrl.style.display = holoEnabled ? "grid" : "none";
    if (!lightEnabled && holoEnabled) {
        toggleLight.checked = true;
        toggleLight.dispatchEvent(new Event('change'));
    }
    if (clothMesh) switchClothMaterial();
};

bindToggle("toggleClothMove", (checked) => {
    clothMoveEnabled = checked;
    if (!checked) endClothMove();
});

bindToggle("toggleWind", (checked) => windEnabled = checked);
bindToggle("toggleCollision", (checked) => collisionEnabled = checked);

bindToggle("toggleTex", (checked) => {
    if (!clothMesh || !cloth) { document.getElementById("toggleTex").checked = false; return; }
    textureEnabled = checked;
    switchClothMaterial();
    if (clothMesh) clothMesh.material.wireframe = showGrid;
    if (thicknessEnabled) updateThicknessMesh();
});

bindToggle("toggleThickness", (checked) => {
    thicknessEnabled = checked;
    document.getElementById("thicknessCtrl").style.display = checked ? "block" : "none";
    document.getElementById("thicknessTexCtrl").style.display = checked ? "grid" : "none";
    document.getElementById("thicknessColorCtrl").style.display = (checked && !thicknessTexEnabled) ? "block" : "none";
    updateThicknessMesh();
});

bindToggle("toggleThicknessTex", (checked) => {
    thicknessTexEnabled = checked;
    document.getElementById("thicknessColorCtrl").style.display = (thicknessEnabled && !checked) ? "block" : "none";
    updateThicknessMesh();
});

bindToggle("toggleGroundShow", (checked) => {
    groundVisible = checked;
    updateGroundDisplay();
});

bindToggle("toggleOutline", (checked) => { outlineEnabled = checked; updateOutlineMesh(); });
bindToggle("toggleGrid", (checked) => {
    showGrid = checked;
    redrawPreview();
    applyGridRendering();
});

/**
 * 🪶 网格线清晰度：three 的 wireframe 只有 1px，而且和布料表面共用深度缓冲 ——
 * 在 3D 视角下既闪烁又被"吃掉"一截。这里给它加 polygonOffset，把线往前推一点点，
 * 实测旋转时线不再忽隐忽现。
 */
function applyGridRendering() {
    if (!clothMesh || !clothMesh.material) return;
    const m = clothMesh.material;
    m.wireframe = showGrid;
    m.polygonOffset = !!showGrid;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    m.needsUpdate = true;
}

// 🪶 线框网格的清晰度：three 的线框 / 三角形网格线太细，3D 视角下几乎看不见。
// 这里统一按"薄片"画：z 方向给一点几何偏移 + 关掉深度写入，避免和布料表面 z-fighting 闪烁。
bindToggle("toggleThicknessMesh", (checked) => { thicknessEnabled = checked; updateThicknessMesh(); });
bindToggle("toggleBlur", (checked) => {
    blurEnabled = checked;
    document.getElementById("blurCtrl").style.display = checked ? "grid" : "none";
    if (checked) blurNeedsReset = true;
    if (!checked && renderer) renderer.setRenderTarget(null);
});

toggleLight.onchange = () => {
    lightEnabled = toggleLight.checked;
    if (lightEnabled) {
        if (!ambientLight || !dirLight) {
            // 💡 使用半球光替代普通环境光，光感更柔和，布料的暗部不会死黑
            ambientLight = new THREE.HemisphereLight(0xffffff, 0x444466, 0.8); 
            
            // 把主光强度稍微提一点 (前提是 UI 上的滑块值不要太低)
            dirLight = new THREE.DirectionalLight(lightColorInput.value, parseFloat(lightIntensitySlider.value) || 1.0);
            dirLight.position.set(parseFloat(lightXSlider.value), parseFloat(lightYSlider.value), parseFloat(lightZSlider.value));
            
            dirLight.castShadow = true; 
            // 🪶 低配模式用更小的阴影贴图
            const shadowSize = lowSpecMode ? LOW_SPEC.SHADOW_SIZE : 2048;
            dirLight.shadow.mapSize.width = shadowSize; 
            dirLight.shadow.mapSize.height = shadowSize;
            dirLight.shadow.camera.near = 0.1; 
            dirLight.shadow.camera.far = 20;
            dirLight.shadow.camera.left = -5; 
            dirLight.shadow.camera.right = 5;
            dirLight.shadow.camera.top = 5; 
            dirLight.shadow.camera.bottom = -5;
            
            dirLight.shadow.bias = -0.0005;
            dirLight.shadow.normalBias = 0.02; 
            
            scene.add(ambientLight); 
            scene.add(dirLight);
        } else {
            ambientLight.visible = true; 
            dirLight.visible = true;
        }
        // ... 后面保持开启影子的逻辑 ...
        
        // 💡 只要开启光影，就默认把“影子”也一起打开
        if (!shadowEnabled) {
            toggleShadow.checked = true;
            toggleShadow.dispatchEvent(new Event('change'));
        }
    } else {
        if (ambientLight) ambientLight.visible = false;
        if (dirLight) dirLight.visible = false;
    }
    if (clothMesh) switchClothMaterial();
    if (thicknessEnabled) updateThicknessMesh();
};

let lastTime = performance.now();
let accumulator = 0;
const MAX_STEPS = 4;

// 自检结果的临时显示状态
let selfCheckText = "";
let selfCheckUntil = 0;

// 🩺 拓扑自检：数一下当前布料有多少对三角面互相穿插（共享顶点的不算）。
// 只在点按钮时跑一次：按 x 轴扫掠 + AABB 预筛，只有盒子重叠的才做精确的边-三角形求交，
// 所以 128 网格也是一次点击的量级（几十毫秒），不会影响解算。
function countClothSelfIntersections() {
    if (!cloth || !cloth.particles || !cloth.geometry) return -1;
    const idx = cloth.geometry.index.array;
    const P = cloth.particles;
    const T = Math.floor(idx.length / 3);
    if (T === 0) return -1;
    const box = new Float32Array(T * 6);
    for (let t = 0; t < T; t++) {
        let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
        for (let k = 0; k < 3; k++) {
            const p = P[idx[t * 3 + k]];
            if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
            if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
            if (p.z < minz) minz = p.z; if (p.z > maxz) maxz = p.z;
        }
        const b = t * 6;
        box[b] = minx; box[b + 1] = miny; box[b + 2] = minz;
        box[b + 3] = maxx; box[b + 4] = maxy; box[b + 5] = maxz;
    }
    const order = new Int32Array(T);
    for (let i = 0; i < T; i++) order[i] = i;
    order.sort((a, b) => box[a * 6] - box[b * 6]);

    const EPS = 1e-9;
    const tri = (t) => [P[idx[t * 3]], P[idx[t * 3 + 1]], P[idx[t * 3 + 2]]];
    const sharesVertex = (a, b) => {
        for (let p = 0; p < 3; p++) {
            const ia = idx[a * 3 + p];
            for (let q = 0; q < 3; q++) if (ia === idx[b * 3 + q]) return true;
        }
        return false;
    };
    const edgeHits = (p0, p1, a, b, c) => {
        const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
        const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (det > -EPS && det < EPS) return false;
        const inv = 1 / det;
        const sx = p0.x - a.x, sy = p0.y - a.y, sz = p0.z - a.z;
        const u = (sx * hx + sy * hy + sz * hz) * inv;
        if (u < 0 || u > 1) return false;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) return false;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        return tt > EPS && tt < 1 - EPS;
    };
    const triTri = (t1, t2) => {
        const A = tri(t1), B = tri(t2);
        return edgeHits(A[0], A[1], B[0], B[1], B[2]) || edgeHits(A[1], A[2], B[0], B[1], B[2]) ||
               edgeHits(A[2], A[0], B[0], B[1], B[2]) || edgeHits(B[0], B[1], A[0], A[1], A[2]) ||
               edgeHits(B[1], B[2], A[0], A[1], A[2]) || edgeHits(B[2], B[0], A[0], A[1], A[2]);
    };

    let count = 0;
    const active = [];
    for (let oi = 0; oi < T; oi++) {
        const a = order[oi];
        const aminx = box[a * 6];
        // 丢掉 x 方向已经不重叠的
        for (let k = active.length - 1; k >= 0; k--) {
            if (box[active[k] * 6 + 3] < aminx) { active[k] = active[active.length - 1]; active.pop(); }
        }
        const amin = [box[a * 6], box[a * 6 + 1], box[a * 6 + 2]];
        const amax = [box[a * 6 + 3], box[a * 6 + 4], box[a * 6 + 5]];
        for (let k = 0; k < active.length; k++) {
            const b = active[k];
            if (box[b * 6] > amax[0] || box[b * 6 + 3] < amin[0] ||
                box[b * 6 + 1] > amax[1] || box[b * 6 + 4] < amin[1] ||
                box[b * 6 + 2] > amax[2] || box[b * 6 + 5] < amin[2]) continue;
            if (sharesVertex(a, b)) continue;
            if (triTri(a, b)) count++;
        }
        active.push(a);
    }
    return count;
}

/** 点一次按钮：把结果临时显示在右下角性能角标里（图标 + 数字，语言无关） */
function runSelfCheck() {
    const n = countClothSelfIntersections();
    if (n < 0) { selfCheckText = "?"; }
    else if (n === 0) { selfCheckText = '<i class="fa-solid fa-circle-check"></i>'; }
    else { selfCheckText = '<i class="fa-solid fa-triangle-exclamation"></i>' + n; }
    selfCheckUntil = performance.now() + 6000;
    updateSolverBadge();
}

// 🩺 求解器状态角标：💤 = 休眠中（整帧跳过解算）；数字 = 本帧实际跑了几遍约束迭代
// 这样"布料不动"到底是被冻住（💤）还是被卡住（有遍数在跑）一眼就能分清
function updateSolverBadge() {
    if (!perfSolverEl) return;
    const dict = window.I18N && window.I18N[window.currentLang];
    if (performance.now() < selfCheckUntil) {
        perfSolverEl.innerHTML = selfCheckText;
        perfSolverEl.title = (dict && dict.selfcheck_hint) || "";
        return;
    }
    const st = (cloth && cloth.solverStats) ? cloth.solverStats() : null;
    if (!st) { perfSolverEl.innerHTML = ""; return; }
    if (st.rescueLeft > 0 || st.rescueHot > 0) {
        perfSolverEl.innerHTML = '<i class="fa-solid fa-wrench"></i>';        // 正在/刚刚自动解缠
        if (dict && dict.perf_solver_hint_rescue) perfSolverEl.title = dict.perf_solver_hint_rescue;
        return;
    }
    if (st.asleep) {
        perfSolverEl.innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
        perfSolverEl.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>' + (st.passes | 0);
    }
    if (dict && dict.perf_solver_hint) perfSolverEl.title = dict.perf_solver_hint;
}

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const rawFrameTime = (now - lastTime) / 1000;   // 真实帧间隔（FPS 用它算）
    lastTime = now;
    let frameTime = rawFrameTime;
    // 🪶 低配模式收紧单帧时间上限，避免卡顿时越补越慢（死亡螺旋）
    const frameCap = lowSpecMode ? 0.05 : 0.1;
    if (frameTime > frameCap) frameTime = frameCap;
    accumulator += frameTime;

    let physicsHz = parseInt(physicsHzEl ? physicsHzEl.value : "100") || 100;
    // 🪶 低配模式物理更新率上限 60Hz
    if (lowSpecMode && physicsHz > LOW_SPEC.MAX_HZ) physicsHz = LOW_SPEC.MAX_HZ;
    const FIXED_DT = 1.0 / physicsHz;
    // 🪶 低配模式每帧最多补 3 次步进：帧率低于 60fps 时也能追上真实时间，
    //    否则布料会变成"慢动作"，看起来就是轻飘飘地飘不动。
    const maxSteps = lowSpecMode ? 3 : MAX_STEPS;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < maxSteps) {
        if (isSimulating) {
            if (shakeFramesLeft > 0) applyShakeImpulse();
            if (cloth) cloth.simulate(FIXED_DT);
            if (clothWetness > 0) updateWetness(FIXED_DT);
            updateDebris(FIXED_DT);
            updateDecorations();
        }
        accumulator -= FIXED_DT;
        steps++;
    }
    // 追不上时丢掉积压，但保留半个步长的相位：
    // 直接清零会让「帧时间略大于固定步长」的情况硬生生掉到一半频率。
    if (steps >= maxSteps && accumulator > FIXED_DT * 0.5) accumulator = FIXED_DT * 0.5;

    // 🪶 性能角标：FPS 常驻显示（低配模式是否真的更流畅，一眼就能看出来）
    if (lowSpecFpsEl) {
        lowSpecFpsCount++;
        lowSpecFpsTime += rawFrameTime;
        if (lowSpecFpsTime >= 0.5) {
            lowSpecFpsEl.textContent = Math.round(lowSpecFpsCount / lowSpecFpsTime) + " FPS";
            lowSpecFpsCount = 0;
            lowSpecFpsTime = 0;
            updateSolverBadge();
        }
    }

    updatePinDots();

    if (renderer) {
        // 🎥 镜头刚动过：速度缓冲里的 prevPosition 是旧视角下的位置，算出来的"速度"是假的
        // → 这段时间内跳过速度缓冲（直接渲染彩色画面），避免动态模糊沿假速度狂拖。
        const cameraJustMoved = performance.now() < cameraMovedUntil;
        if (blurEnabled && !lowSpecMode && rtScene && postMat) {
            if (cameraJustMoved) {
                resetVelocityBuffer();
                renderBlurFrame(true);       // 传 true = 本帧速度沿用 0（跳过 velocity pass）
            } else {
                renderBlurFrame();
            }
        }
        else { renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera); }
    }
}

function initTearCanvas() {
    tearCanvas = document.createElement('canvas');
    tearCanvas.width = 2048;
    tearCanvas.height = 2048;
    tearCtx = tearCanvas.getContext('2d');

    tearCtx.fillStyle = '#ffffff';
    tearCtx.fillRect(0, 0, tearCanvas.width, tearCanvas.height);

    tearTexture = new THREE.CanvasTexture(tearCanvas);
    tearTexture.wrapS = THREE.ClampToEdgeWrapping;
    tearTexture.wrapT = THREE.ClampToEdgeWrapping;
    if ('colorSpace' in tearTexture) tearTexture.colorSpace = THREE.LinearSRGBColorSpace;
}

initTearCanvas();
initThree();
initBlur();
resizeCanvas();
// 🧵 由数据表生成所有预设下拉框（物理 / 材质 / 风力 / 碰撞 / 撕扯）
fillPhysicsPresetOptions();
fillMaterialPresetOptions();
fillWindPresetOptions();
fillCollisionPresetOptions();
fillTearPresetOptions();
fillTextureFilterOptions();
fillPbrTextureOptions();
// 让滑块显示值与默认预设一致
applyPresetToSliders(physicsPresets.cotton);
physicsPresetSelect.value = "cotton";

// 🪶 低配模式：读取上次的选择（极弱设备首次访问会自动开启）
setLowSpecMode(loadLowSpecSetting(), { silent: true });
animate();
redrawPreview();
// 🪶 打开页面时在空白区给出引导（上传图片 → 画固定区域 → 生成布料）
updateEmptyGuide();

updateBgTransform();
window.addEventListener("resize", () => { resizeCanvas(); });
if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeCanvas);

setDrawMode("pinstroke");
toggleTex.checked = textureEnabled;
toggleLight.checked = lightEnabled;
toggleShadow.checked = shadowEnabled;
toggleCollision.checked = collisionEnabled;
toggleOutline.checked = outlineEnabled;
toggleGrid.checked = showGrid;
toggleBlur.checked = blurEnabled;

document.getElementById("windDirValue").textContent = "0°";
document.getElementById("knifeRadiusValue").textContent = parseFloat(knifeRadiusSlider.value).toFixed(3);
document.getElementById("outlineThickValue").textContent = parseFloat(outlineThickSlider.value).toFixed(3);
document.getElementById("thicknessSizeValue").textContent = parseFloat(thicknessSizeSlider.value).toFixed(3);
document.getElementById("massValue").textContent = parseFloat(massSlider.value).toFixed(1);
document.getElementById("dragRadiusValue").textContent = parseFloat(dragRadiusSlider.value).toFixed(2);
document.getElementById("blurStrengthValue").textContent = blurStrength.toFixed(2);
document.getElementById("roughnessValue").textContent = parseFloat(roughnessSlider.value).toFixed(2);
document.getElementById("metalnessValue").textContent = parseFloat(metalnessSlider.value).toFixed(2);
document.getElementById("opacityValue").textContent = parseFloat(opacitySlider.value).toFixed(2);
document.getElementById("maxStretchValue").textContent = parseFloat(maxStretchSlider.value).toFixed(1);
document.getElementById("dampingValue").textContent = parseFloat(dampingSlider.value).toFixed(2);
document.getElementById("constraintIterationsValue").textContent = document.getElementById("constraintIterations").value;
document.getElementById("physicsHzValue").textContent = document.getElementById("physicsHz").value;
document.getElementById("maxDragDistanceValue").textContent = parseFloat(maxDragDistanceSlider.value).toFixed(2);
document.getElementById("meshResValue").textContent = parseInt(meshResSlider.value);
document.getElementById("collisionRadiusValue").textContent = parseFloat(collisionRadiusSlider.value).toFixed(2);
document.getElementById("collisionForceValue").textContent = parseFloat(collisionForceSlider.value).toFixed(1);
document.getElementById("collisionItersValue").textContent = parseInt(collisionItersSlider.value);
document.getElementById("windNoiseAmpValue").textContent = parseFloat(windNoiseAmpSlider.value).toFixed(2);
document.getElementById("windRandomValue").textContent = parseFloat(windRandomSlider.value).toFixed(2);
document.getElementById("windSpeedValue").textContent = parseFloat(windSpeedSlider.value).toFixed(2);
// 新增参数初次显示
document.getElementById("plasticityRateValue").textContent = "0.05";
document.getElementById("plasticityThresholdValue").textContent = "1.05";
document.getElementById("plasticityRecoveryValue").textContent = "0.000";
document.getElementById("plasticityMaxValue").textContent = "3.0";
document.getElementById("bendStiffnessValue").textContent = "0.10";
document.getElementById("shearStiffnessValue").textContent = "1.00";
document.getElementById("stiffXValue").textContent = "1.00";
document.getElementById("stiffYValue").textContent = "1.00";
document.getElementById("springDampingValue").textContent = "0.00";
document.getElementById("windSpatialFreqValue").textContent = "4.0";
document.getElementById("windZValue").textContent = "0.00";
document.getElementById("gravityAngleValue").textContent = "0°";
document.getElementById("groundYValue").textContent = "-1.50";
document.getElementById("groundFrictionValue").textContent = "0.80";
document.getElementById("collisionFrictionValue").textContent = "0.60";
document.getElementById("dragStrengthValue").textContent = "0.40";
document.getElementById("airDampingExpValue").textContent = "0.20";
document.getElementById("maxVelocityValue").textContent = "0.20";
document.getElementById("velocityRetentionValue").textContent = "1.000";

windPresetSelect.value = "breeze";
toggleWind.checked = windEnabled;
if (dragDepthSelect) dragDepthMode = dragDepthSelect.value;
if (tearThresholdSlider) document.getElementById("tearThresholdValue").textContent = parseFloat(tearThresholdSlider.value).toFixed(2);

updateLightPosition();

document.getElementById("evapSpeedValue").textContent = parseFloat(evapSpeedSlider.value).toFixed(4);
document.getElementById("wetnessValue").textContent = "0.0%";
if (waterDropSizeValueEl) waterDropSizeValueEl.textContent = parseFloat(waterDropSizeSlider.value).toFixed(1);
if (waterDropDensityValueEl) waterDropDensityValueEl.textContent = parseFloat(waterDropDensitySlider.value).toFixed(1);
if (waterNormalIntensityValueEl) waterNormalIntensityValueEl.textContent = parseFloat(waterNormalIntensitySlider.value).toFixed(1);

(function initGlobalTooltip() {
    const globalTip = document.createElement('div');
    globalTip.id = 'global-tooltip';
    document.body.appendChild(globalTip);

    let _currentWrap = null;

    // 从 translations 实时读取当前语言文本，带 zh fallback
    function getTooltipText(wrap) {
        const textEl = wrap.querySelector('.tooltip-text');
        if (!textEl) return null;

        const key = textEl.getAttribute('data-i18n');
        if (key && window.I18N) {
            const lang = window.currentLang || 'zh';
            // 语言回退链
            const chain = lang === 'zh-TW' ? ['zh-TW', 'zh']
                        : lang === 'zh' ? ['zh']
                        : [lang, 'en', 'zh'];
            for (const lc of chain) {
                if (window.I18N[lc] && window.I18N[lc][key]) {
                    return window.I18N[lc][key];
                }
            }
        }
        // 没 key 或全部缺失 → 回退到 innerHTML
        return textEl.innerHTML;
    }

    function positionTooltip(target) {
        const rect = target.getBoundingClientRect();
        globalTip.style.left = rect.left + rect.width / 2 + 'px';
        globalTip.style.top = rect.top - 10 + 'px';
    }

    function showTooltip(target) {
        const wrap = target.closest('.tooltip-wrap');
        if (!wrap) return;
        const text = getTooltipText(wrap);
        if (text == null) return;
        globalTip.innerHTML = text;
        positionTooltip(target);
        globalTip.classList.add('show');
        _currentWrap = wrap;
    }

    function hideTooltip() {
        globalTip.classList.remove('show');
        _currentWrap = null;
    }

    // ★ 关键修复：语言切换时，如果 tooltip 正在显示，立即刷新内容
    window.addEventListener('languageChanged', () => {
        if (!_currentWrap) return;
        const text = getTooltipText(_currentWrap);
        if (text != null) globalTip.innerHTML = text;
    });

    document.body.addEventListener('mouseover', e => {
        if (e.target.closest('.tooltip-wrap')) showTooltip(e.target);
    });
    document.body.addEventListener('mouseout', e => {
        if (e.target.closest('.tooltip-wrap')) hideTooltip();
    });
    document.body.addEventListener('touchstart', e => {
        if (e.target.closest('.tooltip-wrap')) {
            e.preventDefault();
            showTooltip(e.target);
            clearTimeout(window._tooltipTimer);
            window._tooltipTimer = setTimeout(hideTooltip, 2000);
        } else {
            hideTooltip();
        }
    }, { passive: false });

    const uiEl = document.getElementById('ui');
    if (uiEl) uiEl.addEventListener('scroll', hideTooltip);
    window.addEventListener('resize', hideTooltip);
})();

const mobileUiToggle = document.getElementById("mobileUiToggle");
const mobileUiClose = document.getElementById("mobileUiClose");
const mobileBackdrop = document.getElementById("mobileBackdrop");
const uiPanel = document.getElementById("ui");
const uiGroups = document.querySelectorAll(".ui-group");

function openMobileMenu() {
    if (uiPanel) uiPanel.classList.add("mobile-open");
    if (mobileBackdrop) mobileBackdrop.classList.add("mobile-open");
    if (window.innerWidth <= 1024) {
        uiGroups.forEach((group, index) => {
            if (index === 0) group.setAttribute("open", "");
            else group.removeAttribute("open");
        });
    }
}
function closeMobileMenu() {
    if (uiPanel) uiPanel.classList.remove("mobile-open");
    if (mobileBackdrop) mobileBackdrop.classList.remove("mobile-open");
}

if (mobileUiToggle) mobileUiToggle.addEventListener("click", openMobileMenu);
if (mobileUiClose) mobileUiClose.addEventListener("click", closeMobileMenu);
if (mobileBackdrop) mobileBackdrop.addEventListener("click", closeMobileMenu);

document.getElementById("genBtn")?.addEventListener("click", () => {
    if (window.innerWidth <= 1024) closeMobileMenu();
});
document.getElementById("backToEditBtn")?.addEventListener("click", () => {
    if (window.innerWidth <= 1024) closeMobileMenu();
});

if (uiPanel) {
    uiPanel.addEventListener('touchstart', e => e.stopPropagation(), { passive: false });
    uiPanel.addEventListener('touchmove', e => e.stopPropagation(), { passive: false });
    uiPanel.addEventListener('touchend', e => e.stopPropagation(), { passive: false });
}

(function initAccordionAnimation() {
    const DUR = 320;
    const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
    document.querySelectorAll('details.ui-group').forEach(details => {
        const content = details.querySelector('.ui-group-content');
        const summary = details.querySelector('summary');
        if (!content || !summary) return;
        const cs = getComputedStyle(content);
        const padT = parseFloat(cs.paddingTop) || 0;
        const padB = parseFloat(cs.paddingBottom) || 0;
        content.style.transition = `height ${DUR}ms ${EASE}, padding-top ${DUR}ms ${EASE}, padding-bottom ${DUR}ms ${EASE}, opacity ${Math.round(DUR * 0.8)}ms ease`;
        const setClosed = () => {
            content.style.height = '0px'; content.style.paddingTop = '0px'; content.style.paddingBottom = '0px'; content.style.opacity = '0';
        };
        const setOpen = () => {
            content.style.height = 'auto'; content.style.paddingTop = ''; content.style.paddingBottom = ''; content.style.opacity = '1';
        };
        if (details.open) setOpen(); else setClosed();
        let animating = false;
        summary.addEventListener('click', (e) => {
            e.preventDefault();
            if (animating) return;
            animating = true;
            if (details.hasAttribute('open')) {
                content.style.height = content.scrollHeight + 'px';
                content.style.paddingTop = padT + 'px'; content.style.paddingBottom = padB + 'px'; content.style.opacity = '1';
                void content.offsetHeight;
                requestAnimationFrame(() => {
                    content.style.height = '0px'; content.style.paddingTop = '0px'; content.style.paddingBottom = '0px'; content.style.opacity = '0';
                });
                let done = false;
                const finish = () => {
                    if (done) return; done = true; animating = false;
                    details.removeAttribute('open');
                    content.style.height = ''; content.style.paddingTop = ''; content.style.paddingBottom = '';
                };
                const onEnd = (ev) => { if (ev.target !== content || ev.propertyName !== 'height') return; content.removeEventListener('transitionend', onEnd); finish(); };
                content.addEventListener('transitionend', onEnd); setTimeout(finish, DUR + 120);
            } else {
                details.setAttribute('open', '');
                content.style.height = '0px'; content.style.paddingTop = '0px'; content.style.paddingBottom = '0px'; content.style.opacity = '0';
                void content.offsetHeight;
                const targetH = content.scrollHeight + padT + padB;
                requestAnimationFrame(() => {
                    content.style.height = targetH + 'px'; content.style.paddingTop = padT + 'px'; content.style.paddingBottom = padB + 'px'; content.style.opacity = '1';
                });
                let done = false;
                const finish = () => {
                    if (done) return; done = true; animating = false; content.style.height = 'auto';
                };
                const onEnd = (ev) => { if (ev.target !== content || ev.propertyName !== 'height') return; content.removeEventListener('transitionend', onEnd); finish(); };
                content.addEventListener('transitionend', onEnd); setTimeout(finish, DUR + 120);
            }
        });
        details.addEventListener('toggle', () => {
            if (animating) return;
            if (details.open) setOpen(); else setClosed();
        });
    });
})();
// ===== 自定义装饰管理 =====
let userCustomModels = []; // 存储 { id, name }

const customDecorSelect = document.getElementById("customDecorSelect");
const btnDeleteCustomDecor = document.getElementById("btnDeleteCustomDecor");
const decorModelInput = document.getElementById("decorModelInput");

if (decorModelInput) {
    decorModelInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const url = URL.createObjectURL(file);
        gltfLoader.load(url, (gltf) => {
            const model = gltf.scene;
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const targetSize = 0.06 * 2.2; 
            const maxDim = Math.max(size.x, size.y, size.z);
            const autoScale = targetSize / maxDim;
            model.scale.setScalar(autoScale);
            model.position.sub(center.multiplyScalar(autoScale));
            model.userData.baseRadius = targetSize * 0.5;
            
            model.traverse((child) => {
                if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
            });
            
            const modelId = 'custom_' + Date.now();
            loadedModels[modelId] = model;
            
            // 保存记录并更新UI
            userCustomModels.push({ id: modelId, name: file.name.replace('.glb','') });
            updateCustomDecorUI();
            
            // 自动选中新上传的模型
            if (customDecorSelect) customDecorSelect.value = modelId;
            if (decorTypeSelect) decorTypeSelect.value = 'custom_upload';
            if (selDecorType) selDecorType.value = 'custom_upload';
            
            URL.revokeObjectURL(url);
        }, undefined, (err) => {
            alert("模型加载失败！请确保是标准的 .glb 格式");
            URL.revokeObjectURL(url);
        });
    });
}

function updateCustomDecorUI() {
    if (!customDecorSelect) return;
    if (userCustomModels.length === 0) {
        customDecorSelect.innerHTML = `<option value="" disabled selected>暂无自定义装饰</option>`;
        return;
    }
    customDecorSelect.innerHTML = userCustomModels.map(m => 
        `<option value="${m.id}">📦 ${m.name}</option>`
    ).join('');
}

if (btnDeleteCustomDecor) {
    btnDeleteCustomDecor.onclick = () => {
        const targetId = customDecorSelect.value;
        if (!targetId) return;
        if (!confirm("确定删除该自定义装饰吗？")) return;
        
        // 从数据中移除
        userCustomModels = userCustomModels.filter(m => m.id !== targetId);
        delete loadedModels[targetId];
        updateCustomDecorUI();
        
        // 如果当前正在使用该模型，取消选中
        if (decorTypeSelect && decorTypeSelect.value === 'custom_upload') {
            decorTypeSelect.value = 'star';
        }
    };
}

// 修改 create3DDecorMesh 中提取模型的逻辑
// 找到 if (loadedModels[type]) 那段，把原来的逻辑改为：
// 如果 type 是 'custom_upload'，则从 customDecorSelect 取当前ID
// 否则直接用 loadedModels[type]
if (btnPourWater) btnPourWater.onclick = pourWater;
// 强制绑定泼水按钮
if (btnPourWater) {
    btnPourWater.onclick = () => {
        console.log("【泼水按钮】被点击了！");
        pourWater();
    };
}
const rotXSlider = document.getElementById("rotXSlider");
const rotYSlider = document.getElementById("rotYSlider");
const rotZSlider = document.getElementById("rotZSlider");
const rotXValue = document.getElementById("rotXValue");
const rotYValue = document.getElementById("rotYValue");
const rotZValue = document.getElementById("rotZValue");
const resetRotBtn = document.getElementById("resetRotBtn");

function handleRotationChange() {
    if (rotXSlider) rotXValue.textContent = rotXSlider.value + "°";
    if (rotYSlider) rotYValue.textContent = rotYSlider.value + "°";
    if (rotZSlider) rotZValue.textContent = rotZSlider.value + "°";
    
    applyClothRotation(
        parseFloat(rotXSlider ? rotXSlider.value : 0), 
        parseFloat(rotYSlider ? rotYSlider.value : 0), 
        parseFloat(rotZSlider ? rotZSlider.value : 0)
    );
}
if (rotXSlider) rotXSlider.addEventListener("input", handleRotationChange);
if (rotYSlider) rotYSlider.addEventListener("input", handleRotationChange);
if (rotZSlider) rotZSlider.addEventListener("input", handleRotationChange);

if (resetRotBtn) {
    resetRotBtn.addEventListener("click", () => {
        if (rotXSlider) rotXSlider.value = 0;
        if (rotYSlider) rotYSlider.value = 0;
        if (rotZSlider) rotZSlider.value = 0;
        handleRotationChange();
    });
}
injectTooltips();
if (window.bindLangSelect) window.bindLangSelect();
