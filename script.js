// 文件名：script.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

let drawMode = "pinstroke";
let eraserMode = "whole";
let isDrawing = false;
let isErasing = false;
let isCutting = false;
let editMode = true;
let isSimulating = true;

let scene, camera, renderer;
let clothMesh = null;
let cloth = null;
let ambientLight = null;
let dirLight = null;
let groundMesh = null;
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



const physicsPresets = {
    cotton: { stiffness: 0.45, maxStretch: 1.5, damping: 0.07, mass: 25.0, meshRes: 24, maxDrag: 0.6, iterations: 6, hz: 100 },
    washed_cotton: { stiffness: 0.35, maxStretch: 1.6, damping: 0.08, mass: 30.0, meshRes: 24, maxDrag: 0.7, iterations: 6, hz: 100 },
    polyester: { stiffness: 0.8, maxStretch: 1.1, damping: 0.08, mass: 20.0, meshRes: 28, maxDrag: 0.4, iterations: 6, hz: 100 },
    tr_blend: { stiffness: 0.6, maxStretch: 1.25, damping: 0.09, mass: 35.0, meshRes: 26, maxDrag: 0.5, iterations: 6, hz: 100 },
    worsted_wool: { stiffness: 0.85, maxStretch: 1.1, damping: 0.12, mass: 70.0, meshRes: 32, maxDrag: 0.3, iterations: 5, hz: 110 },
    denim: { stiffness: 0.85, maxStretch: 1.1, damping: 0.1, mass: 60.0, meshRes: 32, maxDrag: 0.4, iterations: 4, hz: 120 },
    leather: { stiffness: 0.95, maxStretch: 1.05, damping: 0.12, mass: 80.0, meshRes: 36, maxDrag: 0.4, iterations: 4, hz: 120 },
    rubber: { stiffness: 0.15, maxStretch: 3.0, damping: 0.04, mass: 10.0, meshRes: 20, maxDrag: 2.0, iterations: 15, hz: 120 },
    silk: { stiffness: 0.25, maxStretch: 1.8, damping: 0.06, mass: 5.0, meshRes: 40, maxDrag: 0.8, iterations: 8, hz: 100 },
    linen: { stiffness: 0.75, maxStretch: 1.15, damping: 0.08, mass: 15.0, meshRes: 26, maxDrag: 0.5, iterations: 6, hz: 100 },
    chiffon: { stiffness: 0.2, maxStretch: 1.4, damping: 0.05, mass: 2.0, meshRes: 48, maxDrag: 1.0, iterations: 10, hz: 100 },
    canvas: { stiffness: 0.9, maxStretch: 1.05, damping: 0.1, mass: 70.0, meshRes: 40, maxDrag: 0.3, iterations: 5, hz: 120 },
    wool: { stiffness: 0.65, maxStretch: 1.2, damping: 0.09, mass: 45.0, meshRes: 32, maxDrag: 0.5, iterations: 6, hz: 100 },
    velvet: { stiffness: 0.5, maxStretch: 1.3, damping: 0.08, mass: 50.0, meshRes: 36, maxDrag: 0.6, iterations: 7, hz: 100 },
    silicone: { stiffness: 0.8, maxStretch: 1.2, damping: 0.15, mass: 100.0, meshRes: 30, maxDrag: 1.2, iterations: 8, hz: 120 },
    metal: { stiffness: 1.0, maxStretch: 1.0, damping: 0.2, mass: 150.0, meshRes: 32, maxDrag: 0.2, iterations: 3, hz: 120 },
    paper: { stiffness: 0.6, maxStretch: 1.02, damping: 0.05, mass: 2.0, meshRes: 16, maxDrag: 0.2, iterations: 4, hz: 60 },
    neoprene: { stiffness: 0.35, maxStretch: 2.2, damping: 0.12, mass: 50.0, meshRes: 24, maxDrag: 1.0, iterations: 8, hz: 100 },
    plastic: { stiffness: 0.4, maxStretch: 1.6, damping: 0.03, mass: 5.0, meshRes: 28, maxDrag: 1.5, iterations: 10, hz: 100 },
    metalsheet: { stiffness: 1.0, maxStretch: 1.0, damping: 0.25, mass: 200.0, meshRes: 18, maxDrag: 0.2, iterations: 3, hz: 120 },
    jelly: { stiffness: 0.1, maxStretch: 2.8, damping: 0.02, mass: 90.0, meshRes: 24, maxDrag: 2.5, iterations: 15, hz: 120 },
    spidersilk: { stiffness: 0.15, maxStretch: 3.0, damping: 0.04, mass: 0.5, meshRes: 60, maxDrag: 3.0, iterations: 12, hz: 100 },
    clingfilm: { stiffness: 0.5, maxStretch: 2.5, damping: 0.01, mass: 1.0, meshRes: 30, maxDrag: 2.0, iterations: 12, hz: 120 }
};

const tearPresets = {
    soft: 1.05,
    normal: 1.20,
    tough: 1.60,
    metal: 3.00
};

const materialPresets = {
    default: { light: 0.45, rough: 0.75, metal: 0.0, flat: false, opacity: 1.0 },
    cotton: { light: 0.5, rough: 1.0, metal: 0.0, flat: false, opacity: 1.0 },
    silk: { light: 0.6, rough: 0.15, metal: 0.2, flat: false, opacity: 0.8 },
    metal: { light: 0.8, rough: 0.4, metal: 1.0, flat: false, opacity: 1.0 },
    leather: { light: 0.35, rough: 0.95, metal: 0.0, flat: false, opacity: 1.0 },
    holographic: { light: 1.0, rough: 0.1, metal: 0.9, flat: false, opacity: 0.7 },
    gauze: { light: 0.6, rough: 0.85, metal: 0.1, flat: false, opacity: 0.35 },
    chiffon: { light: 0.7, rough: 0.2, metal: 0.2, flat: false, opacity: 0.5 },
    glass: { light: 0.8, rough: 0.05, metal: 0.9, flat: false, opacity: 0.25 },
    jelly: { light: 0.5, rough: 0.3, metal: 0.0, flat: false, opacity: 0.65 },
    film: { light: 0.9, rough: 0.1, metal: 0.6, flat: false, opacity: 0.2 },
    tie_dye: { light: 0.55, rough: 0.75, metal: 0.0, flat: false, opacity: 1.0 },
    batik: { light: 0.4, rough: 0.95, metal: 0.0, flat: false, opacity: 1.0 },
    polyester: { light: 0.6, rough: 0.4, metal: 0.1, flat: false, opacity: 1.0 },
    tr_blend: { light: 0.5, rough: 0.8, metal: 0.0, flat: false, opacity: 1.0 },
    worsted_wool: { light: 0.4, rough: 0.95, metal: 0.0, flat: false, opacity: 1.0 },
    washed_cotton: { light: 0.5, rough: 0.9, metal: 0.0, flat: false, opacity: 1.0 },
    paper: { light: 0.6, rough: 1.0, metal: 0.0, flat: false, opacity: 1.0 },
    wet_cloth: { light: 0.8, rough: 0.2, metal: 0.3, flat: false, opacity: 0.9 }
};

const windPresets = {
    breeze: { strength: 0.3, dir: 0, noiseAmp: 0.4, random: 0.5, speed: 1.6 },
    gentle: { strength: 0.8, dir: 45, noiseAmp: 0.6, random: 0.7, speed: 2.0 },
    strong: { strength: 1.5, dir: 90, noiseAmp: 0.8, random: 0.4, speed: 3.0 },
    gale: { strength: 2.0, dir: 135, noiseAmp: 1.0, random: 0.9, speed: 4.0 }
};

const collisionPresets = {
    perf: { radius: 0.8, force: 0.5, iters: 1 },
    balance: { radius: 0.9, force: 0.8, iters: 2 },
    quality: { radius: 1.1, force: 1.0, iters: 3 }
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
    scene.remove(d3D.mesh);
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
        scene.remove(d.mesh);
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
        scene.add(mesh);
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

physicsPresetSelect.onchange = () => {
    const preset = physicsPresets[physicsPresetSelect.value];
    if (!preset) return;
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

    if (preset.hz) accumulator = 0;
};

materialPresetSelect.onchange = () => {
    const preset = materialPresets[materialPresetSelect.value];
    if (!preset) return;
    lightIntensitySlider.value = preset.light;
    roughnessSlider.value = preset.rough;
    metalnessSlider.value = preset.metal;
    toggleFlat.checked = preset.flat;
    if (preset.opacity !== undefined) { opacitySlider.value = preset.opacity; clothOpacity = preset.opacity; }
    document.getElementById("lightIntensityValue").textContent = parseFloat(preset.light).toFixed(2);
    document.getElementById("roughnessValue").textContent = parseFloat(preset.rough).toFixed(2);
    document.getElementById("metalnessValue").textContent = parseFloat(preset.metal).toFixed(2);
    if (preset.opacity !== undefined) { document.getElementById("opacityValue").textContent = parseFloat(preset.opacity).toFixed(2); }
    if (dirLight && lightEnabled) dirLight.intensity = preset.light;
    if (clothMesh) switchClothMaterial();
    if (thicknessEnabled) updateThicknessMesh();
};

windPresetSelect.onchange = () => {
    const preset = windPresets[windPresetSelect.value];
    if (!preset) return;
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
};

collisionPresetSelect.onchange = () => {
    const preset = collisionPresets[collisionPresetSelect.value];
    if (!preset) return;
    collisionRadiusSlider.value = preset.radius;
    collisionForceSlider.value = preset.force;
    collisionItersSlider.value = preset.iters;
    document.getElementById("collisionRadiusValue").textContent = parseFloat(preset.radius).toFixed(2);
    document.getElementById("collisionForceValue").textContent = parseFloat(preset.force).toFixed(1);
    document.getElementById("collisionItersValue").textContent = parseInt(preset.iters);
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
    imageTexture.needsUpdate = true;

    if (thicknessEnabled) updateThicknessMesh();
}

function updateCamera() {
    zoom = parseFloat(zoomSlider.value);
    camX = parseFloat(camXSlider.value);
    camY = parseFloat(camYSlider.value);
    camZ = 3;

    if (!camera) return;

    const aspect = CANVAS_W / Math.max(1, CANVAS_H);
    const size = 1.3 * zoom;

    if (aspect >= 1) {
        camera.left = -size * aspect; camera.right = size * aspect;
        camera.top = size; camera.bottom = -size;
    } else {
        camera.left = -size; camera.right = size;
        camera.top = size / aspect; camera.bottom = -size / aspect;
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
    if (groundMesh) groundMesh.visible = shadowEnabled;
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
        const gridCount = 8;
        const s = res / gridCount;
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = -1; i <= gridCount; i++) {
            for (let j = -1; j <= gridCount; j++) {
                const x = i * s + s / 2;
                const y = j * s + s / 2;
                const isEven = ((i % gridCount) + gridCount + (j % gridCount) + gridCount) % 2 === 0;
                hCtx.save();
                hCtx.translate(x, y);
                if (isEven) { hCtx.scale(1, 0.4); } else { hCtx.scale(0.4, 1); }
                const r = s * 0.6;
                const grad = hCtx.createRadialGradient(0, 0, 0, 0, 0, r);
                grad.addColorStop(0, "#ffffff");
                grad.addColorStop(1, "#808080");
                hCtx.fillStyle = grad;
                hCtx.beginPath();
                hCtx.arc(0, 0, r, 0, Math.PI * 2);
                hCtx.fill();
                hCtx.restore();
            }
        }
    } else if (type === 'basket') {
        const gridCount = 2;
        const s = res / gridCount;
        hCtx.fillStyle = '#808080';
        hCtx.fillRect(0, 0, res, res);
        for (let i = -1; i <= gridCount; i++) {
            for (let j = -1; j <= gridCount; j++) {
                const x = i * s + s / 2;
                const y = j * s + s / 2;
                const isEven = ((i % gridCount) + gridCount + (j % gridCount) + gridCount) % 2 === 0;
                hCtx.save();
                hCtx.translate(x, y);
                if (isEven) { hCtx.scale(1, 0.25); } else { hCtx.scale(0.25, 1); }
                const r = s * 0.8;
                const grad = hCtx.createLinearGradient(0, -r, 0, r);
                grad.addColorStop(0, "#808080");
                grad.addColorStop(0.5, "#ffffff");
                grad.addColorStop(1, "#808080");
                hCtx.fillStyle = grad;
                hCtx.beginPath();
                hCtx.arc(0, 0, r, 0, Math.PI * 2);
                hCtx.fill();
                hCtx.restore();
            }
        }
    } else if (type === 'herringbone') {
        const cols = 12; 
        const colWidth = res / cols;
        hCtx.lineWidth = colWidth * 0.6; 
        hCtx.lineCap = "round";
        hCtx.lineJoin = "round";
        hCtx.strokeStyle = '#ffffff';
        const h = colWidth * 2;
        for (let i = -1; i <= cols; i++) {
            const x = i * colWidth;
            const isEven = ((i % cols) + cols) % 2 === 0;
            for (let y = -h; y < res + h; y += h) {
                hCtx.beginPath();
                if (isEven) {
                    hCtx.moveTo(x, y + h);
                    hCtx.lineTo(x + colWidth, y + h/2);
                    hCtx.lineTo(x, y);
                } else {
                    hCtx.moveTo(x, y);
                    hCtx.lineTo(x + colWidth, y + h/2);
                    hCtx.lineTo(x, y + h);
                }
                hCtx.stroke();
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
    } else if (type === 'carbon') {
        hCtx.fillStyle = '#505050';
        hCtx.fillRect(0, 0, res, res);
        const count = 16;
        const s = res / count;
        for(let i=0; i<count; i++) {
            for(let j=0; j<count; j++) {
                const isEven = ((i + j) % 4) < 2;
                const cx = i * s;
                const cy = j * s;
                if (isEven) {
                    const grad = hCtx.createLinearGradient(cx, cy, cx + s, cy + s);
                    grad.addColorStop(0, '#404040'); grad.addColorStop(0.5, '#ffffff'); grad.addColorStop(1, '#404040');
                    hCtx.fillStyle = grad;
                    hCtx.fillRect(cx, cy, s, s);
                } else {
                    const grad = hCtx.createLinearGradient(cx + s, cy, cx, cy + s);
                    grad.addColorStop(0, '#404040'); grad.addColorStop(0.5, '#d0d0d0'); grad.addColorStop(1, '#404040');
                    hCtx.fillStyle = grad;
                    hCtx.fillRect(cx, cy, s, s);
                }
            }
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
        hCtx.lineWidth = step * 0.4;
        hCtx.lineCap = "round";
        for(let i=-1; i<=n; i++) {
            for(let j=-1; j<=n; j++) {
                const x = i * step;
                const y = j * step;
                hCtx.beginPath();
                hCtx.strokeStyle = "#ffffff";
                hCtx.arc(x + step/2, y + step*0.8, step*0.6, Math.PI, 0);
                hCtx.stroke();
                hCtx.beginPath();
                hCtx.strokeStyle = "#000000";
                hCtx.arc(x + step/2, y + step*0.2, step*0.6, 0, Math.PI);
                hCtx.stroke();
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
    let baseRepX = baseRepeat, baseRepY = baseRepeat;
    if (imgAspect >= 1) {
        baseRepX = baseRepeat * imgAspect;
    } else {
        baseRepY = baseRepeat / imgAspect;
    }
    let noiseRepX = noiseRepeat, noiseRepY = noiseRepeat;
    if (imgAspect >= 1) {
        noiseRepX = noiseRepeat * imgAspect;
    } else {
        noiseRepY = noiseRepeat / imgAspect;
    }
    if (pbrBaseNormalTexture) {
        pbrBaseNormalTexture.repeat.set(baseRepX, baseRepY);
    }
    if (pbrNoiseNormalTexture) {
        pbrNoiseNormalTexture.repeat.set(noiseRepX, noiseRepY);
    }
    if (pbrAlphaTexture) {
        pbrAlphaTexture.repeat.set(baseRepX, baseRepY);
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
            scene.remove(outlineMesh);
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
            side: THREE.BackSide,
            transparent: clothOpacity < 1.0,
            opacity: clothOpacity,
            depthWrite: clothOpacity >= 1.0
        });
        outlineMesh = new THREE.Mesh(clothMesh.geometry.clone(), outlineMat);
        outlineMesh.frustumCulled = false;
        outlineMesh.castShadow = shadowEnabled;
        scene.add(outlineMesh);
    }
    const srcPos = clothMesh.geometry.attributes.position;
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
            scene.remove(thicknessMesh);
            if (thicknessMat) thicknessMat.dispose();
            thicknessMesh = null; thicknessMat = null;
        }
        return;
    }
    if (!thicknessMesh) {
        thicknessMesh = new THREE.Mesh(cloth.thicknessGeometry, null);
        thicknessMesh.frustumCulled = false;
        thicknessMesh.renderOrder = -1;
        thicknessMesh.castShadow = shadowEnabled;
        scene.add(thicknessMesh);
    }
    if (thicknessMat) thicknessMat.dispose();
    const useTex = thicknessTexEnabled && textureEnabled && imageTexture;
    const isTrans = clothOpacity < 1.0 || pbrAlphaTexture !== null;
    const depthW = clothOpacity >= 1.0 && pbrAlphaTexture === null;
    if (lightEnabled) {
        thicknessMat = new THREE.MeshStandardMaterial({
            color: useTex ? 0xffffff : thicknessColorInput.value,
            map: useTex ? imageTexture : null,
            side: THREE.DoubleSide,
            roughness: parseFloat(roughnessSlider.value),
            metalness: parseFloat(metalnessSlider.value),
            flatShading: flatShadingEnabled,
            envMapIntensity: 0.3,
            transparent: isTrans,
            opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
            depthWrite: depthW,
            normalMap: pbrBaseNormalTexture,
            normalScale: new THREE.Vector2(pbrNormalScale, pbrNormalScale),
            alphaMap: pbrAlphaTexture,
            alphaTest: pbrAlphaTexture ? 0.5 : 0
        });
    } else {
        thicknessMat = new THREE.MeshBasicMaterial({
            color: useTex ? 0xffffff : thicknessColorInput.value,
            map: useTex ? imageTexture : null,
            side: THREE.DoubleSide,
            wireframe: showGrid,
            transparent: isTrans,
            opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
            depthWrite: depthW,
            alphaMap: pbrAlphaTexture,
            alphaTest: pbrAlphaTexture ? 0.5 : 0
        });
    }
    thicknessMesh.material = thicknessMat;
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

function switchClothMaterial() {
    if (!clothMesh) return;
    clothMesh.material.dispose();
    const rough = parseFloat(roughnessSlider.value);
    const metal = parseFloat(metalnessSlider.value);
    const isTrans = clothOpacity < 1.0 || pbrAlphaTexture !== null || (tearTexture !== null);
    const depthW = clothOpacity >= 1.0 && pbrAlphaTexture === null && tearTexture === null;
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
                alphaTest: finalAlphaMap ? 0.05 : 0
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
                alphaTest: finalAlphaMap ? 0.05 : 0
            };
            if (needsShader) {
                stdProps.normalMap = baseNormalForShader;
                stdProps.normalScale = new THREE.Vector2(pbrNormalScale, pbrNormalScale);
            }
            mat = new THREE.MeshStandardMaterial(stdProps);
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
            alphaTest: finalAlphaMap ? 0.05 : 0
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

function renderBlurFrame() {
    const savedColor = renderer.getClearColor(new THREE.Color());
    const savedAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    if (velocityMesh && velocityMesh.geometry && velocityMesh.geometry.attributes.prevPosition) {
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
    postMat.uniforms.strength.value = blurStrength;

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(postScene, postCamera);

    renderer.setClearColor(savedColor, savedAlpha);
}

function initThree() {
    scene = new THREE.Scene();
    scene.background = null;
    updateEnvironment();

    camera = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.1, 50);
    camera.position.set(0, 0, 3);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    const groundGeo = new THREE.PlaneGeometry(20, 20);
    const groundMat = new THREE.ShadowMaterial({ opacity: 0.3, transparent: true, depthWrite: false });
    groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -1.5;
    groundMesh.receiveShadow = true;
    groundMesh.visible = false;
    scene.add(groundMesh);

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
    scene.add(backWallMesh);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
}

function resizeCanvas() {
    const w = Math.max(1, canvasHost.clientWidth);
    const h = Math.max(1, canvasHost.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

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

function tryStartDrag(e) {
    if (!isSimulating) return false;
    if (!clothMesh || !cloth) return false;

    raycaster.setFromCamera(getNDC(e), camera);
    const hits = raycaster.intersectObject(clothMesh, true);

    let hitPoint = new THREE.Vector3();

    if (hits.length > 0) {
        hitPoint.copy(hits[0].point);
    } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const intersectRes = raycaster.ray.intersectPlane(plane, hitPoint);
        if (!intersectRes) return false;
    }

    draggedParticles = [];
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
        dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), hitPoint);
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
        scene.remove(old.mesh);
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
            scene.remove(d.mesh);
            d.mesh.geometry.dispose();
            if (d.mesh.material) d.mesh.material.dispose();
            debrisList.splice(i, 1);
        }
    }
}

function updateDecorations() {
    if (!cloth) return;
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
        const vX = new THREE.Vector3(pR.x - p.x, pR.y - p.y, pR.z - p.z).normalize();
        const vY = new THREE.Vector3(pD.x - p.x, pD.y - p.y, pD.z - p.z).normalize();
        
        let normal = new THREE.Vector3().crossVectors(vX, vY).normalize();
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
        const forward = normal.clone();
        const up = vY.clone().negate(); 
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();
        const trueUp = new THREE.Vector3().crossVectors(forward, right).normalize();

        const m = new THREE.Matrix4().makeBasis(right, trueUp, forward);
        d.mesh.quaternion.setFromRotationMatrix(m);

        // 5. 渲染排序
        d.mesh.renderOrder = (matType === 'jelly') ? 1000 : 10;
        d.mesh.traverse((child) => {
            if (child.isMesh) {
                child.renderOrder = (matType === 'jelly') ? 1000 : 10;
            }
        });
    }
}

function updateDragTarget(e) {
    if (draggedParticles.length === 0) return;
    raycaster.setFromCamera(getNDC(e), camera);
    const newTarget = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, newTarget);

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

            let dx = (targetX - p.x) * 0.4;
            let dy = (targetY - p.y) * 0.4;
            let dz = (targetZ - p.z) * 0.4;

            const moveLen = Math.hypot(dx, dy, dz);
            const maxStep = 0.15;
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
    
    lastClothMovePoint = hitPoint.clone(); 
    clothMovePlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), hitPoint);
    isMovingCloth = true;
    return true;
}

function updateClothMove(e) {
    if (!isMovingCloth || !lastClothMovePoint) return;
    raycaster.setFromCamera(getNDC(e), camera);
    const newPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(clothMovePlane, newPoint)) return;
    
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
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    if (!raycaster.ray.intersectPlane(plane, hitPoint)) return;

    const radius = parseFloat(dragRadiusSlider.value);
    const r2 = radius * radius;
    const grabbed = [];

    for (let i = 0; i < cloth.particles.length; i++) {
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
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), hitPoint);
        multiTouchMap.set(touch.identifier, {
            plane: dragPlane,
            origin: hitPoint.clone(),
            dragged: grabbed
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
            const maxStep = 0.15;
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
            return; 
        }

        if (isCutting) { isCutting = false; saveHistory(); return; }
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
canvasHost.addEventListener("contextmenu", e => e.preventDefault());

canvasHost.addEventListener("wheel", e => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.08 : -0.08;
    zoom = Math.max(0.1, Math.min(3, zoom + delta));
    zoomSlider.value = zoom;
    document.getElementById("zoomValue").textContent = zoom.toFixed(2);
    updateCamera();
}, { passive: false });

canvasHost.addEventListener("touchstart", e => {
    if (e.target.closest('.float-back-btn')) return;
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
    if (!isCanvasTouch) return;
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
                zoom = Math.max(0.1, Math.min(3, zoom + delta));
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
                zoom = Math.max(0.1, Math.min(3, zoom + delta));
                zoomSlider.value = zoom;
                document.getElementById("zoomValue").textContent = zoom.toFixed(2);
                updateCamera();
            }
            touchDistStart = dist;
        }
    }
}, { passive: false });

function handleTouchEnd(e) {
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

function destroyCloth() {
    if (clothMesh) { scene.remove(clothMesh); clothMesh.geometry.dispose(); clothMesh.material.dispose(); clothMesh = null; cloth = null; }
    if (outlineMesh) { scene.remove(outlineMesh); outlineMesh.geometry.dispose(); outlineMat.dispose(); outlineMesh = null; outlineMat = null; }
    if (thicknessMesh) { scene.remove(thicknessMesh); if (thicknessMat) thicknessMat.dispose(); thicknessMesh = null; thicknessMat = null; }
    if (velocityMesh && velocityScene) { velocityScene.remove(velocityMesh); velocityMesh = null; }
    multiTouchMap.clear();
    draggedParticles = [];
    clothWetness = 0; waterEnabled = false; lastWetnessPercent = -1;
    if (wetnessValueEl) wetnessValueEl.textContent = "0.0%";
    activeShaderRef = null;
    if (waterDropNormalTexture) { waterDropNormalTexture.dispose(); waterDropNormalTexture = null; }
    if (waterTexRebuildTimer) { clearTimeout(waterTexRebuildTimer); waterTexRebuildTimer = null; }
    for (const d of debrisList) { scene.remove(d.mesh); d.mesh.geometry.dispose(); if (d.mesh.material) d.mesh.material.dispose(); }
    debrisList = [];
    if (tearCtx) { tearCtx.fillStyle = '#ffffff'; tearCtx.fillRect(0, 0, tearCanvas.width, tearCanvas.height); if (tearTexture) tearTexture.needsUpdate = true; }
    decorations.forEach(d => scene.remove(d.mesh));
    decorations = [];
    clothMoveEnabled = false;
    endClothMove();
    const moveToggle = document.getElementById("toggleClothMove");
    if (moveToggle) moveToggle.checked = false;
}

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

                let initialVx = 0;
                let initialVy = 0;
                let initialVz = 0;

                if (!shouldPin) {
                    const swingFactor = (resY - j) / resY;
                    initialVx = 0.008 * swingFactor;
                    initialVy = 0.003 * swingFactor;
                    initialVx += Math.sin(j * 0.6) * 0.03;
                    initialVy += Math.cos(i * 0.6) * 0.02;
                    initialVz = (Math.random() - 0.5) * 0.03;
                }

                const startZ = (Math.random() - 0.5) * 0.02;

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
        for (let j = 0; j <= resY; j++) {
            for (let i = 0; i <= resX; i++) {
                const idx = grid[j][i];
                if (i + 1 <= resX) this.addSpring(idx, grid[j][i + 1]);
                if (j + 1 <= resY) this.addSpring(idx, grid[j + 1][i]);
            }
        }
        for (let j = 0; j < resY; j++) {
            for (let i = 0; i < resX; i++) {
                const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i], d = grid[j + 1][i + 1];
                this.addSpring(a, d); this.addSpring(b, c);
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
            transparent: clothOpacity < 1.0 || pbrAlphaTexture !== null || tearTexture !== null,
            opacity: pbrAlphaTexture ? Math.max(clothOpacity, 0.15) : clothOpacity,
            depthWrite: clothOpacity >= 1.0 && pbrAlphaTexture === null && tearTexture === null,
            alphaMap: tearTexture !== null ? tearTexture : pbrAlphaTexture,
            alphaTest: (tearTexture !== null || pbrAlphaTexture !== null) ? 0.05 : 0
        });
        this.mesh = new THREE.Mesh(this.geometry, mat);
        this.mesh.castShadow = shadowEnabled;
        this.mesh.receiveShadow = shadowEnabled;

        this.collisionGrid = new Map();
        this.collisionFrameCount = 0;
    }

    addSpring(i, j) {
        const p1 = this.particles[i], p2 = this.particles[j];
        const sIdx = this.springs.length;
        this.springs.push({ i, j, restLength: Math.hypot(p1.x - p2.x, p1.y - p2.y), broken: false });

        if (!p1.springs) p1.springs = [];
        if (!p2.springs) p2.springs = [];
        p1.springs.push(sIdx);
        p2.springs.push(sIdx);
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
        this.geometry.computeVertexNormals();
        const normals = this.geometry.attributes.normal.array;
        if (!this.normals) this.normals = new Float32Array(this.particles.length * 3);
        this.normals.set(normals);
        if (thicknessEnabled && this.thicknessGeometry) {
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

    solveCollision(lockedIndices) {
        const pLen = this.particles.length;
        if (pLen === 0) return;

        const decorMap = new Map();
        decorations.forEach(d => decorMap.set(d.particleIndex, d.weight));

        const baseRadius = this.baseRestLength * parseFloat(collisionRadiusSlider.value);
        const getRadius = (idx) => {
            let r = baseRadius;
            if (decorMap.has(idx)) {
                const w = decorMap.get(idx);
                // 🔧 调低排斥半径，避免布料被撑得过开
                if (w === 'heavy') r *= 1.5; 
                else if (w === 'light') r *= 1.15;
                else r *= 1.2; 
            }
            return r;
        };

        const cellSize = baseRadius * 3;
        const invCellSize = 1.0 / cellSize;

        const gridMap = this.collisionGrid;
        gridMap.clear();

        for (let i = 0; i < pLen; i++) {
            const p = this.particles[i];
            const cx = Math.floor(p.x * invCellSize);
            const cy = Math.floor(p.y * invCellSize);
            const cz = Math.floor(p.z * invCellSize);
            const hash = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
            let cell = gridMap.get(hash);
            if (!cell) {
                cell = [];
                gridMap.set(hash, cell);
            }
            cell.push(i);
        }

        for (let i = 0; i < pLen; i++) {
            const p1 = this.particles[i];
            const cx = Math.floor(p1.x * invCellSize);
            const cy = Math.floor(p1.y * invCellSize);
            const cz = Math.floor(p1.z * invCellSize);

            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    for (let oz = -1; oz <= 1; oz++) {
                        const hash = ((cx + ox) * 73856093) ^ ((cy + oy) * 19349663) ^ ((cz + oz) * 83492791);
                        const cell = gridMap.get(hash);
                        if (!cell) continue;

                        for (let k = 0; k < cell.length; k++) {
                            const j = cell[k];
                            if (j <= i) continue;

                            const p2 = this.particles[j];
                            if (Math.abs(p1.ix - p2.ix) <= 1 && Math.abs(p1.iy - p2.iy) <= 1) continue;

                            const isP1Locked = lockedIndices.has(i);
                            const isP2Locked = lockedIndices.has(j);
                            if ((p1.pinned || isP1Locked) && (p2.pinned || isP2Locked)) continue;

                            const dx = p2.x - p1.x;
                            const dy = p2.y - p1.y;
                            const dz = p2.z - p1.z;
                            const d2 = dx * dx + dy * dy + dz * dz;

                            const r1 = getRadius(i);
                            const r2 = getRadius(j);
                            const currentRadius = Math.max(r1, r2);

                            if (d2 < currentRadius * currentRadius) {
                                let d = Math.sqrt(d2) || 0.001;
                                let nx = dx / d, ny = dy / d, nz = dz / d;

                                // 限制单次推开的最大距离，防止瞬间弹飞
                                const overlapDist = currentRadius - d;
                                const maxPush = currentRadius * 0.25;
                                const pushAmount = Math.min(overlapDist, maxPush) * parseFloat(collisionForceSlider.value);

                                if (decorMap.get(i) === 'heavy') p1.z -= pushAmount * 0.5;
                                if (decorMap.get(j) === 'heavy') p2.z -= pushAmount * 0.5;

                                const w1 = (p1.pinned || isP1Locked) ? 0 : p1.invMass;
                                const w2 = (p2.pinned || isP2Locked) ? 0 : p2.invMass;
                                const wSum = w1 + w2;
                                if (wSum === 0) continue;

                                const move1 = pushAmount * (w1 / wSum);
                                const move2 = pushAmount * (w2 / wSum);

                                // 移动位置
                                p1.x -= nx * move1; p1.y -= ny * move1; p1.z -= nz * move1;
                                p2.x += nx * move2; p2.y += ny * move2; p2.z += nz * move2;

                                // 🔧 同步历史位置，并加入阻尼（摩擦），减少由于碰撞产生的多余弹跳
                                const damping = 0.6; 
                                p1.oldX -= nx * move1 * damping; p1.oldY -= ny * move1 * damping; p1.oldZ -= nz * move1 * damping;
                                p2.oldX += nx * move2 * damping; p2.oldY += ny * move2 * damping; p2.oldZ += nz * move2 * damping;
                            }
                        }
                    }
                }
            }
        }
    }

        simulate(dt) {
        const lockedIndices = new Set();
        for (const item of draggedParticles) lockedIndices.add(item.index);
        for (const data of multiTouchMap.values()) {
            for (const item of data.dragged) lockedIndices.add(item.index);
        }
        const simMult = parseFloat(simMultSlider.value);
        let wind = windEnabled ? parseFloat(windSlider.value) : 0;
        const ang = parseFloat(windDirSlider.value) * Math.PI / 180;
        const stiff = parseFloat(stiffnessSlider.value);
        const dampCoeff = parseFloat(dampingSlider.value);
        const baseMass = Math.max(0.1, parseFloat(massSlider.value));
        const noiseAmp = parseFloat(windNoiseAmpSlider.value);
        const noiseRandom = parseFloat(windRandomSlider.value);
        const noiseSpeed = parseFloat(windSpeedSlider.value);
        const t = performance.now() * 0.001;
        const baseWindX = Math.cos(ang), baseWindY = Math.sin(ang);
        const subDt = dt * simMult, dt2 = subDt * subDt;
        const stretchLimit = parseFloat(maxStretchSlider.value);
        const effectiveStiff = stiff * (1.5 / stretchLimit);
        const maxDelta = 0.2;

        // 💡 新增：提前计算所有粒子上挂载的装饰物重量，避免在循环里反复查找，大幅提升性能
        // 💡 修复：将赋值改为累加，并加大力度
        const decorGravityMap = new Float32Array(this.particles.length);
        for (let d of decorations) {
            if (d.particleIndex < this.particles.length) {
                let extraG = 0;
                if (d.weight === 'heavy') extraG = 2.5;   // 💡 从 0.95 加到 2.5，重物强拉扯
                else if (d.weight === 'medium') extraG = 1.0; // 中物中等拉扯
                else if (d.weight === 'light') extraG = -0.2; // 轻物甚至微飘
                decorGravityMap[d.particleIndex] += extraG; // 💡 使用累加，防止多个装饰在同一个点覆盖
            }
        }

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            if (p.pinned || lockedIndices.has(i)) continue;
            
            // 💡 获取该粒子上的装饰拉扯力
            const extraGravity = decorGravityMap[i];

            const gravityAccel = 0.1 * 40;
            const massRatio = baseMass / 25.0;
            const retention = Math.max(0, 1.0 - dampCoeff * Math.pow(massRatio, 0.2));
            const windAccelBase = wind * 35 * Math.pow(massRatio, -0.5);
            const vx = (p.x - p.oldX) * retention;
            const vy = (p.y - p.oldY) * retention;
            const vz = (p.z - p.oldZ) * retention;
            p.oldX = p.x; p.oldY = p.y; p.oldZ = p.z;
            const nx = p.x * 4.0 + t * noiseSpeed;
            const ny = p.y * 4.0 + t * noiseSpeed * 1.2;
            const nz = p.z * 4.0 + t * noiseSpeed * 0.8;
            const turbulenceX = Math.sin(nx) * Math.cos(ny) + Math.sin(nz * 1.3) * Math.cos(nx * 0.9);
            const turbulenceY = Math.sin(ny) * Math.cos(nz) + Math.sin(nx * 1.1) * Math.cos(ny * 0.8);
            const turbulenceZ = Math.sin(nz) * Math.cos(nx) + Math.sin(ny * 1.4) * Math.cos(nz * 1.1);
            const windForceX = (baseWindX + turbulenceX * noiseRandom) * windAccelBase * noiseAmp;
            const windForceY = (baseWindY + turbulenceY * noiseRandom) * windAccelBase * noiseAmp;
            const windForceZ = (turbulenceZ * noiseRandom) * windAccelBase * noiseAmp;
            
            let dx = vx + windForceX * dt2;
            // 💡 将装饰的重力叠加到向下的受力中
            let dy = vy + (windForceY - gravityAccel - extraGravity) * dt2; 
            let dz = vz + windForceZ * dt2;
            
            dx = Math.max(-maxDelta, Math.min(maxDelta, dx));
            dy = Math.max(-maxDelta, Math.min(maxDelta, dy));
            dz = Math.max(-maxDelta, Math.min(maxDelta, dz));
            p.x += dx; p.y += dy; p.z += dz;
            const groundY = -1.5;
            if (p.y < groundY) { p.y = groundY; p.oldY = p.y + (p.y - p.oldY) * 0.2; }
        }

        const iterations = parseInt(document.getElementById("constraintIterations").value);
        for (let iter = 0; iter < iterations; iter++) {
            for (const s of this.springs) {
                if (s.broken) continue;
                const p1 = this.particles[s.i], p2 = this.particles[s.j];
                const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
                const dist = Math.hypot(dx, dy, dz);
                if (dist === 0) continue;
                const w1 = (p1.pinned || lockedIndices.has(s.i)) ? 0 : p1.invMass;
                const w2 = (p2.pinned || lockedIndices.has(s.j)) ? 0 : p2.invMass;
                const wSum = w1 + w2;
                if (wSum === 0) continue;
                const maxStretch = s.restLength * stretchLimit;
                let diffX = 0, diffY = 0, diffZ = 0;
                if (dist > maxStretch) {
                    const excess = dist - maxStretch;
                    const nx = dx / dist, ny = dy / dist, nz = dz / dist;
                    diffX = nx * excess; diffY = ny * excess; diffZ = nz * excess;
                } else {
                    const diff = (dist - s.restLength) / dist * effectiveStiff;
                    diffX = dx * diff; diffY = dy * diff; diffZ = dz * diff;
                }
                const maxCorrection = 0.2;
                diffX = Math.max(-maxCorrection, Math.min(maxCorrection, diffX));
                diffY = Math.max(-maxCorrection, Math.min(maxCorrection, diffY));
                diffZ = Math.max(-maxCorrection, Math.min(maxCorrection, diffZ));
                p1.x += diffX * (w1 / wSum); p1.y += diffY * (w1 / wSum); p1.z += diffZ * (w1 / wSum);
                p2.x -= diffX * (w2 / wSum); p2.y -= diffY * (w2 / wSum); p2.z -= diffZ * (w2 / wSum);
            }
        }

        const collisionIters = parseInt(collisionItersSlider.value);
        if (collisionEnabled) {
            const iters = lockedIndices.size > 0 ? 1 : collisionIters;
            for (let ci = 0; ci < iters; ci++) {
                this.solveCollision(lockedIndices);
            }
        }

        this.updateGeo();
        if (outlineEnabled && outlineMesh) updateOutlineMesh();
    }
}

document.getElementById("genBtn").onclick = () => {
    if (!loadedImage) { alert(window.I18N[window.currentLang].alert_no_img); return; }
    destroyCloth();
    const meshRes = parseInt(meshResSlider.value);
    let maxW = BOUND_SCALE * 2 * 0.95;
    let maxH = maxW;
    if (imgAspect >= 1) maxH = maxW / imgAspect; else maxW = maxH * imgAspect;
    const bounds = { minX: -maxW / 2, maxX: maxW / 2, minY: -maxH / 2, maxY: maxH / 2 };

    cloth = new Cloth(bounds, pinStrokeList, meshRes);
    clothMesh = cloth.mesh;
    scene.add(clothMesh);

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
    if (!isSimulating) pauseBtn.click();
    if (rotXSlider) { rotXSlider.value = 0; rotXValue.textContent = "0°"; prevRotX = 0; }
    if (rotZSlider) { rotZSlider.value = 0; rotZValue.textContent = "0°"; prevRotZ = 0; }
};

function setEditMode(on) {
    editMode = on;
    previewCanvas.style.display = on ? "block" : "none";
    document.getElementById("backToEditBtn").style.display = on ? "none" : "block";
    if (!on) {
        isDrawing = false; isCutting = false;
        if (typeof endDrag === "function") endDrag();
        multiTouchMap.clear();
    }
}

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

bindToggle("toggleOutline", (checked) => { outlineEnabled = checked; updateOutlineMesh(); });
bindToggle("toggleGrid", (checked) => { showGrid = checked; redrawPreview(); if (clothMesh) clothMesh.material.wireframe = checked; });
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
            dirLight.shadow.mapSize.width = 2048; 
            dirLight.shadow.mapSize.height = 2048;
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

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    let frameTime = (now - lastTime) / 1000;
    lastTime = now;
    if (frameTime > 0.1) frameTime = 0.1;
    accumulator += frameTime;

    const physicsHz = parseInt(document.getElementById("physicsHz")?.value || "100");
    const FIXED_DT = 1.0 / physicsHz;

    let steps = 0;
    while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
        if (isSimulating) {
            if (cloth) cloth.simulate(FIXED_DT);
            if (clothWetness > 0) updateWetness(FIXED_DT);
            updateDebris(FIXED_DT);
            updateDecorations();
        }
        accumulator -= FIXED_DT;
        steps++;
    }
    if (steps === MAX_STEPS) accumulator = 0;

    if (renderer) {
        if (blurEnabled && rtScene && postMat) renderBlurFrame();
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
animate();
redrawPreview();

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
    function positionTooltip(target) {
        const rect = target.getBoundingClientRect();
        globalTip.style.left = rect.left + rect.width / 2 + 'px';
        globalTip.style.top = rect.top - 10 + 'px';
    }
    function showTooltip(target) {
        const wrap = target.closest('.tooltip-wrap');
        if (!wrap) return;
        const textEl = wrap.querySelector('.tooltip-text');
        if (!textEl) return;
        globalTip.innerHTML = textEl.innerHTML;
        positionTooltip(target);
        globalTip.classList.add('show');
    }
    function hideTooltip() { globalTip.classList.remove('show'); }
    document.body.addEventListener('mouseover', e => { if (e.target.closest('.tooltip-wrap')) showTooltip(e.target); });
    document.body.addEventListener('mouseout', e => { if (e.target.closest('.tooltip-wrap')) hideTooltip(); });
    document.body.addEventListener('touchstart', e => {
        if (e.target.closest('.tooltip-wrap')) {
            e.preventDefault(); showTooltip(e.target);
            clearTimeout(window._tooltipTimer);
            window._tooltipTimer = setTimeout(hideTooltip, 2000);
        } else { hideTooltip(); }
    }, { passive: false });
    document.getElementById('ui').addEventListener('scroll', hideTooltip);
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
