import * as THREE from "/vendor/three/build/three.module.js";
import { OrbitControls } from "/vendor/three/examples/jsm/controls/OrbitControls.js";

(function app() {
  const STORAGE_KEYS = {
    favorites: "meteorscope.favorites",
    subscriptions: "meteorscope.subscriptions",
  };

  const state = {
    neo: [],
    notable: [],
    displayList: [],
    selected: null,
    hoveredId: null,
    compare: new Set(),
    favorites: new Set(),
    subscriptions: [],
    meshes: {},
    orbitLines: {},
    selectedOrbitId: null,
    orbitTickMeshes: [],
    sourceStatus: null,
    cardImageMap: {},
    timelineOffset: 0,
    playbackDirection: 0,
    playbackSpeedIndex: 3,
    orbitsVisible: true,
    searchMode: false,
    searchQuery: "",
    searchResults: [],
    uiState: "loading",
    selectedTrail: [],
    viewMode: "schematic",
  };

  // 实际比例下场景单位约定：1 scene unit = 1,000,000 km（1 Gm）
  // 太阳半径 0.6957、地球半径 0.006371、地球公转半径 149.6（1 AU），参考 CelestiaProject/Celestia 的真实尺寸数据。
  // halo/corona 的 scale 表示「sprite 宽度 / 太阳半径」，与 schematic 模式下 halo=21 / sunR=4.2 ≈ 5 保持视觉比例一致。
  const REAL_SCALE = {
    sunRadius: 0.6957,
    sunHaloScale: 5.2,
    sunCoronaScale: 9.0,
    bodies: {
      "planet-mercury": { orbitRadius: 57.909, size: 0.002440, focusDistance: 0.02 },
      "planet-venus": { orbitRadius: 108.208, size: 0.006052, focusDistance: 0.05 },
      "planet-earth": { orbitRadius: 149.598, size: 0.006371, focusDistance: 0.05 },
      "moon-earth": { orbitRadius: 0.38440, size: 0.001737, focusDistance: 0.014 },
      "planet-mars": { orbitRadius: 227.939, size: 0.003390, focusDistance: 0.03 },
      "planet-jupiter": { orbitRadius: 778.340, size: 0.06991, focusDistance: 0.5 },
      "planet-saturn": { orbitRadius: 1433.449, size: 0.05823, focusDistance: 0.8 },
      "moon-titan": { orbitRadius: 1.22187, size: 0.002574, focusDistance: 0.02 },
      "moon-iapetus": { orbitRadius: 3.56082, size: 0.000734, focusDistance: 0.01 },
      "planet-uranus": { orbitRadius: 2876.679, size: 0.025362, focusDistance: 0.2 },
      "planet-neptune": { orbitRadius: 4503.443, size: 0.024622, focusDistance: 0.2 },
    },
  };

  // Celestia 风格「低于显示下限的天体 point marker」。
  // 实际比例下大部分天体的真实几何在远视角是亚像素，Celestia 的做法是用恒定屏幕大小的发光点补位，
  // 并根据天体真实半径做分级：Sun 远大于 Jupiter，Jupiter 远大于 Earth，Earth 稍大于 Mercury。
  // px = sprite 宽度（像素），在 animate() 中会按相机距离动态转换为 world scale。
  const REAL_BODY_MARKER = {
    "sun-core":       { px: 64, color: 0xffd58a, haloColor: 0xffbd5a, haloPx: 150 },
    "planet-mercury": { px: 4.5, color: 0xc6b9a4 },
    "planet-venus":   { px: 6.5, color: 0xf7d997 },
    "planet-earth":   { px: 7, color: 0x7fd7ff },
    "moon-earth":     { px: 3, color: 0xcfd7df },
    "planet-mars":    { px: 5.5, color: 0xffab7e },
    "planet-jupiter": { px: 18, color: 0xf9d3a6 },
    "planet-saturn":  { px: 16, color: 0xf7d2a2 },
    "moon-titan":     { px: 3.2, color: 0xf0c48d },
    "moon-iapetus":   { px: 2.6, color: 0xe7ddd1 },
    "planet-uranus":  { px: 10, color: 0x9bf0ff },
    "planet-neptune": { px: 10, color: 0x7ca5ff },
  };

  // 实际比例模式相机/控制器的默认展示范围（以"1 单位 = 1 百万 km"为基准）。
  const REAL_VIEW_CAMERA = {
    position: new THREE.Vector3(0, 260, 620),
    target: new THREE.Vector3(0, 0, 0),
    minDistance: 0.0015,
    maxDistance: 12000,
  };
  const SCHEMATIC_VIEW_CAMERA = {
    position: new THREE.Vector3(0, 32, 96),
    target: new THREE.Vector3(0, -1.2, 0),
    minDistance: 12,
    maxDistance: 280,
  };

  const canvas = document.getElementById("solar-canvas");
  const overviewSectionEl = document.getElementById("monitor");
  const statusBar = document.getElementById("status-bar");
  const moduleUpdatedEl = document.getElementById("module-updated");
  const sourceStatusEl = document.getElementById("source-status");
  const currentPreviewEl = document.getElementById("current-preview");
  const selectedPreviewEl = document.getElementById("selected-preview");
  const selectedNameEl = document.getElementById("selected-name");
  const selectedCopyEl = document.getElementById("selected-copy");
  const selectedMetricsEl = document.getElementById("selected-metrics");
  const featuredTargetsEl = document.getElementById("featured-targets");
  const degradedHintTextEl = document.getElementById("degraded-hint-text");
  const retryDataBtn = document.getElementById("retry-data-btn");
  const meteorGridEl = document.getElementById("meteor-grid");
  const orbitTooltipEl = document.getElementById("orbit-tooltip");
  const sceneObjectLabelEl = document.getElementById("scene-object-label");
  const sceneLabelLayerEl = document.getElementById("scene-label-layer");
  const selectionCursorEl = document.getElementById("scene-selection-cursor");
  const cardModalEl = document.getElementById("card-modal");
  const modalDescEl = document.getElementById("modal-desc");
  const modalTitleEl = document.getElementById("modal-title");
  const modalLinksEl = document.getElementById("modal-links");
  const modalCloseBtn = document.getElementById("modal-close-btn");
  const searchInputEl = document.getElementById("search-input");
  const searchBtnEl = document.getElementById("search-btn");
  const typeFilterEl = document.getElementById("type-filter");
  const compareBoardEl = document.getElementById("compare-board");
  const favoritesListEl = document.getElementById("favorites-list");
  const subscriptionsListEl = document.getElementById("subscriptions-list");
  const startTourBtn = document.getElementById("start-tour-btn");
  const focusEarthBtn = document.getElementById("focus-earth-btn");
  const locateBtn = document.getElementById("locate-btn");
  const compareBtn = document.getElementById("compare-btn");
  const favoriteBtn = document.getElementById("favorite-btn");
  const subscribeBtn = document.getElementById("subscribe-btn");
  const DEFAULT_SUBSCRIBE_THRESHOLD_KM = 50000000;
  const timelineValueEl = document.getElementById("timeline-value");
  const timelineSpeedEl = document.getElementById("timeline-speed");
  const timelineBackwardBtn = document.getElementById("timeline-backward-btn");
  const timelinePlayPauseBtn = document.getElementById("timeline-play-pause-btn");
  const timelineForwardBtn = document.getElementById("timeline-forward-btn");
  const timelineSlowerBtn = document.getElementById("timeline-slower-btn");
  const timelineFasterBtn = document.getElementById("timeline-faster-btn");
  const orbitToggleBtn = document.getElementById("orbit-toggle-btn");
  const scaleModeBtn = document.getElementById("scale-mode-btn");
  const timelineResetBtn = document.getElementById("timeline-reset-btn");
  const statNeo = document.getElementById("stat-neo");
  const statNotable = document.getElementById("stat-notable");
  const PLAYBACK_SPEED_STEPS = [1, 5, 10, 30, 60, 120, 365];
  const METEOR_IMAGE_POOL = [
    "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?auto=format&fit=crop&w=1280&q=60",
    "https://images.unsplash.com/photo-1610296669228-602fa827fc1f?auto=format&fit=crop&w=1280&q=60",
    "https://images.unsplash.com/photo-1539721972319-f0e80a00d424?auto=format&fit=crop&w=1280&q=60",
    "https://images.unsplash.com/photo-1484950763426-56b5bf172dbb?auto=format&fit=crop&w=1280&q=60",
    "https://images.unsplash.com/photo-1502134249126-9f3755a50d78?auto=format&fit=crop&w=1280&q=60",
    "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/planetary-defense/3I_interstellar%20comet%20orbit.jpg?w=1840&h=1200&fit=clip&crop=faces%2Cfocalpoint",
  ];
  // 离线兜底的著名陨石/撞击事件图鉴。在远端 /api/notable 不可达时使用，
  // 与 shared/data/notable-meteorites.json 保持同步，保证离线依然能看到完整的科普信息。
  const LOCAL_NOTABLE_FALLBACK = [
    {
      id: "chelyabinsk-2013",
      name: "车里雅宾斯克陨石",
      type: "石陨石",
      location: "俄罗斯 车里雅宾斯克州",
      year: "2013",
      diameter: "约 17-20 m（母体）",
      speed: "约 19 km/s",
      nearest: "2013-02-15 03:20 UTC",
      risk: "高关注历史事件",
      description: "进入大气后强烈空爆，冲击波导致大范围建筑玻璃破碎，是现代城市观测记录最完整的流星体事件之一。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "tunguska-1908",
      name: "通古斯大爆炸",
      type: "空爆事件",
      location: "俄罗斯 西伯利亚",
      year: "1908",
      diameter: "母体估计 50-80 m",
      speed: "约 15-30 km/s（估）",
      nearest: "1908-06-30 07:14 当地时间",
      risk: "历史极高关注",
      description: "现代史上最大规模的已知天体空爆事件，夷平约 2,150 平方公里森林，未找到明显陨石坑，推断为彗星或含水小行星在高空解体。",
      source: "https://en.wikipedia.org/wiki/Tunguska_event",
      image: "",
    },
    {
      id: "hoba",
      name: "霍巴陨石 Hoba",
      type: "铁陨石",
      location: "纳米比亚",
      year: "1920",
      diameter: "约 2.7 m（最长）",
      speed: "历史坠落速度未知",
      nearest: "古代坠落，现代发现",
      risk: "低",
      description: "已知地表现存质量最大的单体陨石之一（约 60 吨），主要由铁镍合金构成，科普价值与收藏价值都非常高。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "sikhote-alin",
      name: "锡霍特-阿林陨石雨",
      type: "铁陨石",
      location: "俄罗斯 远东",
      year: "1947",
      diameter: "母体估计数米级",
      speed: "约 14 km/s",
      nearest: "1947-02-12 22:38 UTC",
      risk: "中",
      description: "一次典型的大规模铁陨石散落事件，留下大量撞击坑，成为研究破碎过程与散落场的重要样本。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "allende",
      name: "阿连德陨石 Allende",
      type: "石陨石",
      location: "墨西哥 奇瓦瓦州",
      year: "1969",
      diameter: "碎块群分布广",
      speed: "约 14 km/s（估）",
      nearest: "1969-02-08",
      risk: "低",
      description: "碳质球粒陨石代表，富含早期太阳系信息，常被用于研究原始物质与行星形成历史。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "murchison",
      name: "默奇森陨石 Murchison",
      type: "石陨石",
      location: "澳大利亚 维多利亚州",
      year: "1969",
      diameter: "碎块群分布广",
      speed: "约 12 km/s（估）",
      nearest: "1969-09-28",
      risk: "低",
      description: "以有机分子研究著名，检测到多种氨基酸，是天体化学与生命起源研究中的经典对象。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "ensisheim",
      name: "恩西斯海姆陨石 Ensisheim",
      type: "石陨石",
      location: "法国 阿尔萨斯",
      year: "1492",
      diameter: "约 1.2 m（估）",
      speed: "历史记录不完整",
      nearest: "1492-11-16",
      risk: "历史著名事件",
      description: "欧洲中世纪最有名的陨石坠落事件之一，文献记录丰富，对历史天象研究具有特殊价值。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "brenham",
      name: "布伦汉姆 Brenham",
      type: "石铁陨石",
      location: "美国 堪萨斯州",
      year: "1882",
      diameter: "多块体",
      speed: "未知",
      nearest: "古代坠落，近代发现",
      risk: "低",
      description: "著名橄榄陨铁产地，兼具铁镍金属与橄榄石晶体，视觉辨识度极高。",
      source: "https://www.lpi.usra.edu/meteor/",
      image: "",
    },
    {
      id: "canyon-diablo",
      name: "代阿布罗峡谷 Canyon Diablo",
      type: "铁陨石",
      location: "美国 亚利桑那州（巴林杰陨石坑）",
      year: "约 5 万年前",
      diameter: "母体 30-50 m",
      speed: "约 12.8 km/s",
      nearest: "史前事件",
      risk: "历史高能量撞击",
      description: "形成了直径约 1.2 km 的巴林杰陨石坑，是地球上保存最完整的撞击坑之一，铁镍碎块散布广泛。",
      source: "https://en.wikipedia.org/wiki/Canyon_Diablo_(meteorite)",
      image: "",
    },
    {
      id: "willamette",
      name: "威拉米特 Willamette",
      type: "铁陨石",
      location: "美国 俄勒冈州",
      year: "古代坠落",
      diameter: "约 3 m",
      speed: "历史记录不完整",
      nearest: "19 世纪末发现",
      risk: "低",
      description: "北美最大的陨石（质量约 15.5 吨），由克拉克马斯部落早在历史上便视为神圣之物，现藏于美国自然历史博物馆。",
      source: "https://en.wikipedia.org/wiki/Willamette_Meteorite",
      image: "",
    },
    {
      id: "peekskill-1992",
      name: "皮克斯基尔陨石 Peekskill",
      type: "石陨石",
      location: "美国 纽约州",
      year: "1992",
      diameter: "约 12 kg 主体",
      speed: "约 14.7 km/s",
      nearest: "1992-10-09",
      risk: "低（城区落点）",
      description: "现代最著名的录像事件之一，多个业余摄像机拍下壮观火流星轨迹，主体最终砸穿一辆停放的轿车，成为陨石学与公众传播的经典案例。",
      source: "https://en.wikipedia.org/wiki/Peekskill_meteorite",
      image: "",
    },
    {
      id: "tagish-lake-2000",
      name: "塔吉什湖陨石 Tagish Lake",
      type: "石陨石",
      location: "加拿大 不列颠哥伦比亚省",
      year: "2000",
      diameter: "母体 5-6 m",
      speed: "约 15.8 km/s",
      nearest: "2000-01-18",
      risk: "低",
      description: "坠落在冰冻湖面，迅速冷冻采集，保留了罕见的原始有机分子与水化矿物，成为研究早期太阳系挥发物的顶级样本。",
      source: "https://en.wikipedia.org/wiki/Tagish_Lake_(meteorite)",
      image: "",
    },
    {
      id: "carancas-2007",
      name: "卡兰卡斯陨石 Carancas",
      type: "石陨石",
      location: "秘鲁 的的喀喀湖畔",
      year: "2007",
      diameter: "母体约 1 m",
      speed: "约 3-5 km/s（末速）",
      nearest: "2007-09-15",
      risk: "中（小范围爆炸）",
      description: "一颗较小的石陨石以非常规的高速撞击，形成直径 13 m 的新鲜陨石坑，并造成附近居民出现短期气味与不适，刷新了小天体撞击的认知。",
      source: "https://en.wikipedia.org/wiki/2007_Carancas_impact_event",
      image: "",
    },
    {
      id: "fukang",
      name: "阜康橄榄陨铁 Fukang",
      type: "石铁陨石",
      location: "中国 新疆阜康",
      year: "2000 发现",
      diameter: "主体约 1 m",
      speed: "未知",
      nearest: "古代坠落，现代发现",
      risk: "低",
      description: "世界上最壮观的橄榄陨铁之一，切片后橄榄石晶体在光线下呈宝石级金黄色，是东亚地区最著名的陨石标本。",
      source: "https://en.wikipedia.org/wiki/Fukang_(meteorite)",
      image: "",
    },
    {
      id: "jilin-1976",
      name: "吉林陨石雨",
      type: "石陨石",
      location: "中国 吉林永吉",
      year: "1976",
      diameter: "最大单体 1,770 kg",
      speed: "约 15.8 km/s",
      nearest: "1976-03-08",
      risk: "中（无人员伤亡）",
      description: "20 世纪最大规模的石陨石雨之一，散落场覆盖 500 多平方公里，主体 1 号陨石是目前世界上最大的石陨石单体之一，对研究陨石破碎具有里程碑意义。",
      source: "https://en.wikipedia.org/wiki/Jilin_meteorite",
      image: "",
    },
  ];

  function createGlowTexture(innerColor, outerColor = "rgba(255,255,255,0)") {
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 256;
    glowCanvas.height = 256;
    const ctx = glowCanvas.getContext("2d");
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    gradient.addColorStop(0, innerColor);
    gradient.addColorStop(0.24, innerColor);
    gradient.addColorStop(0.72, outerColor);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(glowCanvas);
  }

  // 陨石 marker 的 9×9 像素风格纹理：
  // - 中心 1 像素完全不透明（硬点）；
  // - 围绕中心的 8 个像素半透明（3×3 核心的 bloom 外缘）；
  // - 再外一圈（5×5 的 16 个像素）以更低透明度做微弱晕；
  // - 其余直到 9×9 边界完全透明。
  // 使用 NearestFilter，保证缩放到目标像素时仍是方格、无模糊。
  function createMeteorPixelTexture() {
    const size = 9;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(size, size);
    const center = Math.floor(size / 2); // 4
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = Math.abs(x - center);
        const dy = Math.abs(y - center);
        const ring = Math.max(dx, dy);
        let alpha = 0;
        if (ring === 0) alpha = 255;
        else if (ring === 1) alpha = 150;
        else if (ring === 2) alpha = 55;
        else alpha = 0;
        const idx = (y * size + x) * 4;
        img.data[idx] = 255;
        img.data[idx + 1] = 255;
        img.data[idx + 2] = 255;
        img.data[idx + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  function createIapetusTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 2048;
    textureCanvas.height = 1024;
    const ctx = textureCanvas.getContext("2d");
    if (!ctx) return null;

    const base = ctx.createLinearGradient(0, 0, textureCanvas.width, 0);
    base.addColorStop(0, "#17191d");
    base.addColorStop(0.26, "#433527");
    base.addColorStop(0.49, "#8f7957");
    base.addColorStop(0.52, "#dbd7c9");
    base.addColorStop(0.78, "#d7d0bf");
    base.addColorStop(1, "#ece7db");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

    for (let i = 0; i < 2200; i += 1) {
      const x = Math.random() * textureCanvas.width;
      const y = Math.random() * textureCanvas.height;
      const r = Math.random() * 7 + 1;
      const alpha = 0.04 + Math.random() * 0.12;
      ctx.fillStyle = `rgba(${x < textureCanvas.width * 0.46 ? "15,16,19" : "255,255,255"}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function createCanvasTexture(width, height, draw) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = width;
    textureCanvas.height = height;
    const ctx = textureCanvas.getContext("2d");
    if (!ctx) return null;
    draw(ctx, textureCanvas);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function createMoonTexture() {
    return createCanvasTexture(2048, 1024, (ctx, canvas) => {
      ctx.fillStyle = "#8d8f93";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 3200; i += 1) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const r = Math.random() * 16 + 2;
        ctx.fillStyle = `rgba(50, 52, 56, ${0.03 + Math.random() * 0.08})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(220, 224, 228, ${0.04 + Math.random() * 0.06})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  function createJupiterTexture() {
    return createCanvasTexture(2048, 1024, (ctx, canvas) => {
      const colors = ["#d7ba96", "#b98257", "#f0dfc5", "#9d6b45", "#d8b086", "#f2e4d2", "#a5754d"];
      let y = 0;
      while (y < canvas.height) {
        const bandHeight = 30 + Math.random() * 70;
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.fillRect(0, y, canvas.width, bandHeight);
        y += bandHeight;
      }
      for (let i = 0; i < 850; i += 1) {
        const px = Math.random() * canvas.width;
        const py = Math.random() * canvas.height;
        const w = 40 + Math.random() * 160;
        const h = 10 + Math.random() * 28;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.07})`;
        ctx.beginPath();
        ctx.ellipse(px, py, w, h, Math.random() * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(189, 105, 74, 0.78)";
      ctx.beginPath();
      ctx.ellipse(canvas.width * 0.72, canvas.height * 0.58, 150, 74, -0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(252, 220, 200, 0.32)";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.ellipse(canvas.width * 0.72, canvas.height * 0.58, 158, 82, -0.08, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  function createVenusTexture() {
    return createCanvasTexture(2048, 1024, (ctx, canvas) => {
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, "#d7b072");
      gradient.addColorStop(0.5, "#f0cf94");
      gradient.addColorStop(1, "#c88d55");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 1200; i += 1) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const rx = 80 + Math.random() * 180;
        const ry = 16 + Math.random() * 46;
        ctx.fillStyle = `rgba(255, 235, 206, ${0.04 + Math.random() * 0.06})`;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, Math.random() * 0.4 - 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function createEarthCloudTexture() {
    return createCanvasTexture(2048, 1024, (ctx, canvas) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < 1600; i += 1) {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height;
        const rx = 16 + Math.random() * 80;
        const ry = 8 + Math.random() * 24;
        ctx.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, Math.random() * 0.8 - 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  const scene = new THREE.Scene();
  const SCHEMATIC_FOG = new THREE.FogExp2(0x02050a, 0.0022);
  scene.fog = SCHEMATIC_FOG;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: true,
  });
  renderer.setClearColor(0x02050a, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  // 使用对数深度缓冲 + 极大的可见深度范围，让示意与实际两种比例都不出现 Z-fighting。
  const camera = new THREE.PerspectiveCamera(52, 1, 0.001, 200000);
  camera.position.set(0, 32, 96);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 12;
  controls.maxDistance = 280;
  controls.target.set(0, -1.2, 0);
  const desiredControlTarget = controls.target.clone();
  const desiredCameraPosition = camera.position.clone();
  let isAutoNavigatingCamera = false;
  let focusedTargetId = null;
  const focusedCameraOffset = new THREE.Vector3();

  const textureLoader = new THREE.TextureLoader();
  const TEXTURE_FILES = {
    sun: "/assets/textures/sun.jpg",
    starsMilkyWay: "/assets/textures/stars-milky-way.jpg",
    mercury: "/assets/textures/mercury.jpg",
    venusSurface: createVenusTexture(),
    venusAtmosphere: createVenusTexture(),
    earthDay: "/assets/textures/earth-day.jpg",
    earthNight: "/assets/textures/earth-night.jpg",
    earthClouds: createEarthCloudTexture(),
    moon: createMoonTexture(),
    mars: "/assets/textures/mars.jpg",
    jupiter: createJupiterTexture(),
    saturn: "/assets/textures/saturn.jpg",
    saturnRing: "/assets/textures/saturn-ring-alpha.png",
  };
  const textureCache = new Map();
  const AXIS_Y = new THREE.Vector3(0, 1, 0);
  const AXIS_Z = new THREE.Vector3(0, 0, 1);
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const staticBodies = [];
  const staticOrbitConfigs = [];
  const sceneBodyLabels = new Map();

  function makeTextureUrl(fileName) {
    return fileName;
  }

  function resolveTexture(source, options = {}) {
    if (!source) return null;
    if (source.isTexture) return source;
    const { colorSpace = "srgb", repeatX = 1, repeatY = 1, rotation = 0 } = options;
    const cacheKey = `${source}:${colorSpace}:${repeatX}:${repeatY}:${rotation}`;
    if (textureCache.has(cacheKey)) {
      return textureCache.get(cacheKey);
    }
    const texture = textureLoader.load(makeTextureUrl(source));
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    texture.colorSpace = colorSpace === "srgb" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.rotation = rotation;
    textureCache.set(cacheKey, texture);
    return texture;
  }

  function createAtmosphereShell(radius, color, opacity = 0.14, scale = 1.08) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius * scale, 40, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
  }

  function createRingMesh(innerRadius, outerRadius, textureSource) {
    const ringGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 160, 1);
    const pos = ringGeometry.attributes.position;
    const uv = ringGeometry.attributes.uv;
    for (let i = 0; i < pos.count; i += 1) {
      tempVecA.fromBufferAttribute(pos, i);
      const radius = tempVecA.length();
      const u = (radius - innerRadius) / Math.max(outerRadius - innerRadius, 0.0001);
      uv.setXY(i, u, 0.5);
    }
    const ringTexture = resolveTexture(textureSource, { colorSpace: "srgb" });
    return new THREE.Mesh(
      ringGeometry,
      new THREE.MeshStandardMaterial({
        map: ringTexture,
        alphaMap: ringTexture,
        color: 0xdfd0b3,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        roughness: 0.86,
        metalness: 0.02,
        emissive: 0x4d4234,
        emissiveIntensity: 0.12,
        depthWrite: false,
      })
    );
  }

  function createPlanetMesh(config) {
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(config.size, 48, 48),
      new THREE.MeshStandardMaterial({
        map: resolveTexture(config.texture, { colorSpace: "srgb" }),
        emissiveMap: config.emissiveTexture ? resolveTexture(config.emissiveTexture, { colorSpace: "srgb" }) : null,
        emissive: config.emissiveColor ?? 0x000000,
        emissiveIntensity: config.emissiveIntensity ?? 0,
        roughness: config.roughness ?? 0.88,
        metalness: config.metalness ?? 0.02,
        color: config.tint ?? 0xffffff,
      })
    );

    if (config.atmosphereColor) {
      const atmosphere = createAtmosphereShell(
        config.size,
        config.atmosphereColor,
        config.atmosphereOpacity ?? 0.12,
        config.atmosphereScale ?? 1.08
      );
      surface.add(atmosphere);
      surface.userData.atmosphere = atmosphere;
    }

    if (config.cloudTexture) {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(config.size * 1.018, 40, 40),
        new THREE.MeshStandardMaterial({
          map: resolveTexture(config.cloudTexture, { colorSpace: "srgb" }),
          transparent: true,
          opacity: config.cloudOpacity ?? 0.82,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          roughness: 1,
          metalness: 0,
        })
      );
      surface.add(clouds);
      surface.userData.cloudLayer = clouds;
    }

    if (config.haloColor) {
      const haloTexture = createGlowTexture(config.haloInner || "rgba(196,229,255,0.82)", "rgba(255,255,255,0)");
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture,
          color: config.haloColor,
          transparent: true,
          opacity: config.haloOpacity ?? 0.22,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      halo.scale.setScalar(config.haloScale ?? config.size * 4.2);
      surface.add(halo);
      surface.userData.halo = halo;
    }

    if (config.ring) {
      const ring = createRingMesh(config.ring.innerRadius, config.ring.outerRadius, config.ring.texture);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.z = config.ring.rotationZ || 0;
      surface.add(ring);
      surface.userData.ring = ring;
    }

    return surface;
  }

  function registerStaticBody(config) {
    const mesh = createPlanetMesh(config);
    const realCfg = REAL_SCALE.bodies[config.id] || null;
    const schematicMode = {
      orbitRadius: config.radius,
      size: config.size,
      focusDistance: config.focusDistance || null,
    };
    const realisticMode = realCfg
      ? {
          orbitRadius: realCfg.orbitRadius,
          size: realCfg.size,
          focusDistance: realCfg.focusDistance || null,
        }
      : schematicMode;
    mesh.userData = {
      id: config.id,
      name: config.name,
      type: config.type || (config.group === "moon" ? "卫星" : "行星"),
      location: config.location,
      diameter: config.diameter,
      speed: config.speed,
      nearest: config.nearest || `${config.radius / 10} AU`,
      risk: config.risk || "低",
      description: config.description,
      group: config.group || "planet",
      radius: config.radius,
      orbitRadius: config.radius,
      orbitCenterId: config.orbitCenterId || null,
      periodDays: config.periodDays,
      phaseDays: config.phaseDays || 0,
      initialPhaseDays: config.initialPhaseDays || 0,
      eccentricity: config.eccentricity || 0,
      argumentOfPeriapsisDeg: config.argumentOfPeriapsisDeg || 0,
      inclinationDeg: config.inclinationDeg || 0,
      ascendingNodeDeg: config.ascendingNodeDeg || 0,
      selfSpin: config.selfSpin || 0,
      cloudSpin: config.cloudSpin || 0,
      visualRadius: config.size,
      focusDistance: config.focusDistance || null,
      baseEmissiveIntensity: config.emissiveIntensity || 0,
      showSceneLabel: config.showSceneLabel !== false,
      sceneLabel: config.sceneLabel || config.name,
      baseSize: config.size,
      modes: { schematic: schematicMode, realistic: realisticMode },
    };

    planetMeshes[config.id] = mesh;
    staticBodies.push(mesh);
    scene.add(mesh);

    if (!config.orbitCenterId) {
      staticOrbitConfigs.push({
        id: config.id,
        radius: config.radius,
        periodDays: config.periodDays,
        eccentricity: config.eccentricity || 0,
        argumentOfPeriapsisDeg: config.argumentOfPeriapsisDeg || 0,
        inclinationDeg: config.inclinationDeg || 0,
        ascendingNodeDeg: config.ascendingNodeDeg || 0,
        modes: {
          schematic: { radius: config.radius },
          realistic: { radius: realCfg ? realCfg.orbitRadius : config.radius },
        },
      });
    }

    if (sceneLabelLayerEl && mesh.userData.showSceneLabel) {
      const labelEl = document.createElement("div");
      labelEl.className = "scene-body-label";
      labelEl.textContent = mesh.userData.sceneLabel;
      sceneLabelLayerEl.append(labelEl);
      sceneBodyLabels.set(config.id, labelEl);
    }

    return mesh;
  }

  function solveEccentricAnomaly(meanAnomaly, eccentricity) {
    let anomaly = meanAnomaly;
    for (let i = 0; i < 5; i += 1) {
      anomaly -= (anomaly - eccentricity * Math.sin(anomaly) - meanAnomaly) / Math.max(1 - eccentricity * Math.cos(anomaly), 0.0001);
    }
    return anomaly;
  }

  function computeOrbitalPosition(
    radius,
    angle,
    inclinationDeg = 0,
    ascendingNodeDeg = 0,
    target = new THREE.Vector3(),
    eccentricity = 0,
    argumentOfPeriapsisDeg = 0
  ) {
    const clampedEccentricity = THREE.MathUtils.clamp(eccentricity, 0, 0.92);
    const eccentricAnomaly =
      clampedEccentricity > 0.0001 ? solveEccentricAnomaly(angle, clampedEccentricity) : angle;
    const cosE = Math.cos(eccentricAnomaly);
    const sinE = Math.sin(eccentricAnomaly);
    const semiMinor = radius * Math.sqrt(Math.max(1 - clampedEccentricity * clampedEccentricity, 0.0001));
    target.set(radius * (cosE - clampedEccentricity), 0, semiMinor * sinE);
    if (argumentOfPeriapsisDeg) {
      target.applyAxisAngle(AXIS_Y, THREE.MathUtils.degToRad(argumentOfPeriapsisDeg));
    }
    if (inclinationDeg) {
      target.applyAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(inclinationDeg));
    }
    if (ascendingNodeDeg) {
      target.applyAxisAngle(AXIS_Y, THREE.MathUtils.degToRad(ascendingNodeDeg));
    }
    return target;
  }

  // 行星位置校准的 AU -> 场景半径映射，分段线性。
  // 根据反馈：原分布把 Mars~Jupiter 压得太近，感觉和印象中的真实距离不符。
  // 这里采用更接近真实比例的对数压缩——内行星保持密集，外行星依然拉开足够的"空旷感"。
  const AU_TO_SCENE_POINTS = [
    [0, 0],
    [0.387, 6.8],
    [0.723, 10.2],
    [1.0, 13.2],
    [1.524, 18.2],
    [5.203, 34],
    [9.537, 52],
    [19.2, 78],
    [30.07, 100],
  ];

  function auToScene(aAU) {
    const a = Math.max(0, Number(aAU) || 0);
    if (state.viewMode === "realistic") {
      // 实际比例：1 AU = 149.598 百万 km，保持与行星真实半长轴一致。
      return a * 149.598;
    }
    const pts = AU_TO_SCENE_POINTS;
    if (a >= pts[pts.length - 1][0]) {
      const [lastA, lastScene] = pts[pts.length - 1];
      return lastScene + Math.log2(a / lastA) * 5;
    }
    for (let i = 1; i < pts.length; i += 1) {
      const [a0, s0] = pts[i - 1];
      const [a1, s1] = pts[i];
      if (a <= a1) {
        const t = (a - a0) / Math.max(1e-6, a1 - a0);
        return s0 + t * (s1 - s0);
      }
    }
    return pts[pts.length - 1][1];
  }

  // 开普勒第三定律：T(yr) = a(AU)^1.5
  function keplerPeriodDays(aAU) {
    const a = Math.max(0.05, Number(aAU) || 0.05);
    return 365.256 * Math.pow(a, 1.5);
  }

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function seededRandom(seed, index = 0) {
    let x = (seed + index * 2654435761) >>> 0;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return (x % 100000) / 100000;
  }

  function epochDaysFromDate(date) {
    if (!date) return 0;
    const d = date instanceof Date ? date : new Date(date);
    const t = d.getTime();
    if (!Number.isFinite(t)) return 0;
    return t / 86400000;
  }

  scene.add(new THREE.AmbientLight(0x8ba8cf, 0.32));
  scene.add(new THREE.HemisphereLight(0x789fe0, 0x04070d, 0.34));
  const sunLight = new THREE.PointLight(0xffd382, 4.8, 480, 1.6);
  sunLight.position.set(0, 0, 0);
  scene.add(sunLight);
  const dir = new THREE.DirectionalLight(0xe6f0ff, 0.58);
  dir.position.set(34, 26, 18);
  scene.add(dir);
  const rimLight = new THREE.DirectionalLight(0x4f84d6, 0.42);
  rimLight.position.set(-28, 14, -16);
  scene.add(rimLight);

  const deepSpaceSphere = new THREE.Mesh(
    new THREE.SphereGeometry(760, 64, 64),
    new THREE.MeshBasicMaterial({
      map: resolveTexture(TEXTURE_FILES.starsMilkyWay, { colorSpace: "srgb" }),
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    })
  );
  scene.add(deepSpaceSphere);

  const nebulaSprites = [
    { position: new THREE.Vector3(-340, 58, -310), scale: 220, color: 0x5b6ec9, opacity: 0.16 },
    { position: new THREE.Vector3(320, -28, -420), scale: 260, color: 0x9476d8, opacity: 0.12 },
    { position: new THREE.Vector3(220, 88, 320), scale: 170, color: 0x7da1ff, opacity: 0.1 },
  ].map((cfg) => {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture("rgba(255,255,255,0.55)", "rgba(255,255,255,0)"),
        color: cfg.color,
        transparent: true,
        opacity: cfg.opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    sprite.position.copy(cfg.position);
    sprite.scale.setScalar(cfg.scale);
    scene.add(sprite);
    return sprite;
  });

  // 示意比例下的太阳半径。真实 Sun:Earth ≈ 109:1，这里做可视化压缩让它明显大于行星又不会吞没 Mercury 轨道。
  const SCHEMATIC_SUN_RADIUS = 4.2;
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(SCHEMATIC_SUN_RADIUS, 48, 48),
    new THREE.MeshStandardMaterial({
      color: 0xffd279,
      map: resolveTexture(TEXTURE_FILES.sun, { colorSpace: "srgb" }),
      emissiveMap: resolveTexture(TEXTURE_FILES.sun, { colorSpace: "srgb" }),
      emissive: 0xffa11f,
      emissiveIntensity: 1.32,
      roughness: 0.22,
      metalness: 0.08,
    })
  );
  sun.userData = { id: "sun-core", visualRadius: SCHEMATIC_SUN_RADIUS };
  scene.add(sun);
  const sunGlowTexture = createGlowTexture("rgba(255,190,92,0.9)", "rgba(255,164,54,0.16)");
  const sunHalo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunGlowTexture,
      color: 0xffd58c,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sunHalo.scale.set(21, 21, 1);
  scene.add(sunHalo);
  const sunCorona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunGlowTexture,
      color: 0xffa84d,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sunCorona.scale.set(36, 36, 1);
  scene.add(sunCorona);
  const planetMeshes = {};
  const iapetusTexture = createIapetusTexture();
  registerStaticBody({
    id: "planet-mercury",
    name: "水星",
    sceneLabel: "水星",
    location: "内太阳系 / 第一轨道",
    diameter: "4,879 km",
    speed: "47.36 km/s",
    description: "最贴近太阳的岩质行星，用来建立空间尺度与轨道速度基准。",
    radius: 6.8,
    size: 0.22,
    periodDays: 88,
    phaseDays: 0,
    eccentricity: 0.2056,
    argumentOfPeriapsisDeg: 29.1,
    inclinationDeg: 7,
    ascendingNodeDeg: 48.3,
    selfSpin: 0.0012,
    texture: TEXTURE_FILES.mercury,
    roughness: 0.95,
    haloColor: 0xbabec7,
    haloOpacity: 0.08,
    haloScale: 1.8,
  });
  registerStaticBody({
    id: "planet-venus",
    name: "金星",
    sceneLabel: "金星",
    location: "内太阳系 / 第二轨道",
    diameter: "12,104 km",
    speed: "35.02 km/s",
    description: "厚重大气层带来强烈散射光晕，是模拟器观感中的重要层次体。",
    radius: 10.2,
    size: 0.36,
    periodDays: 225,
    phaseDays: 14,
    eccentricity: 0.0068,
    argumentOfPeriapsisDeg: 54.9,
    inclinationDeg: 3.4,
    ascendingNodeDeg: 76.7,
    selfSpin: 0.00045,
    texture: TEXTURE_FILES.venusSurface,
    cloudTexture: TEXTURE_FILES.venusAtmosphere,
    cloudOpacity: 0.6,
    tint: 0xf5d3ad,
    roughness: 0.9,
    atmosphereColor: 0xe4bc7e,
    atmosphereOpacity: 0.12,
    haloColor: 0xffd2a0,
    haloOpacity: 0.18,
    haloScale: 3.1,
  });
  registerStaticBody({
    id: "planet-earth",
    name: "地球",
    sceneLabel: "地球",
    location: "宜居带 / 第三轨道",
    diameter: "12,742 km",
    speed: "29.78 km/s",
    description: "首页监测视角的基准参照点，也是近地目标与主轨道层级的核心标尺。",
    radius: 13.2,
    size: 0.38,
    periodDays: 365.256,
    phaseDays: 0,
    eccentricity: 0.0167,
    argumentOfPeriapsisDeg: 114.2,
    inclinationDeg: 0,
    ascendingNodeDeg: -11.2,
    selfSpin: 0.0024,
    cloudSpin: 0.0032,
    texture: TEXTURE_FILES.earthDay,
    emissiveTexture: TEXTURE_FILES.earthNight,
    emissiveColor: 0xffffff,
    emissiveIntensity: 0.22,
    cloudTexture: TEXTURE_FILES.earthClouds,
    roughness: 0.72,
    atmosphereColor: 0x59bfff,
    atmosphereOpacity: 0.16,
    atmosphereScale: 1.1,
    haloColor: 0x7fd7ff,
    haloOpacity: 0.16,
    haloScale: 4.3,
    focusDistance: 5.6,
  });
  registerStaticBody({
    id: "moon-earth",
    name: "月球",
    sceneLabel: "月球",
    group: "moon",
    location: "地月系统",
    diameter: "3,474 km",
    speed: "1.02 km/s",
    nearest: "384,400 km",
    description: "地球卫星，用来增强近景层次与模拟器式标签密度。",
    orbitCenterId: "planet-earth",
    radius: 1.05,
    size: 0.12,
    periodDays: 27.32,
    phaseDays: 8,
    eccentricity: 0.0549,
    argumentOfPeriapsisDeg: 318.1,
    inclinationDeg: 5.14,
    ascendingNodeDeg: 13,
    selfSpin: 0.0008,
    texture: TEXTURE_FILES.moon,
    roughness: 0.96,
    haloColor: 0xcfd7df,
    haloOpacity: 0.07,
    haloScale: 1.4,
    showSceneLabel: true,
    focusDistance: 3.2,
  });
  registerStaticBody({
    id: "planet-mars",
    name: "火星",
    sceneLabel: "火星",
    location: "内太阳系外缘 / 第四轨道",
    diameter: "6,779 km",
    speed: "24.07 km/s",
    description: "作为内外圈过渡节点，火星负责建立更像真实模拟器的视深节奏。",
    radius: 18.2,
    size: 0.26,
    periodDays: 687,
    phaseDays: 37,
    eccentricity: 0.0934,
    argumentOfPeriapsisDeg: 286.5,
    inclinationDeg: 1.9,
    ascendingNodeDeg: 49.6,
    selfSpin: 0.0018,
    texture: TEXTURE_FILES.mars,
    roughness: 0.9,
    haloColor: 0xffab7e,
    haloOpacity: 0.08,
    haloScale: 2.4,
  });
  registerStaticBody({
    id: "planet-jupiter",
    name: "木星",
    sceneLabel: "木星",
    location: "外太阳系 / 第五轨道",
    diameter: "139,820 km",
    speed: "13.07 km/s",
    description: "大体量气态巨行星提供强烈的近景压迫感，是 Celestia 式镜头的重要支点。",
    radius: 34,
    size: 1.08,
    periodDays: 4333,
    phaseDays: 61,
    eccentricity: 0.0489,
    argumentOfPeriapsisDeg: 273.9,
    inclinationDeg: 1.3,
    ascendingNodeDeg: 100.6,
    selfSpin: 0.0034,
    texture: TEXTURE_FILES.jupiter,
    roughness: 0.88,
    haloColor: 0xf9d3a6,
    haloOpacity: 0.12,
    haloScale: 6.4,
    focusDistance: 8.2,
  });
  registerStaticBody({
    id: "planet-saturn",
    name: "土星",
    sceneLabel: "土星",
    location: "外太阳系 / 第六轨道",
    diameter: "116,460 km",
    speed: "9.68 km/s",
    description: "加入真实环系和卫星后，土星承担当前 3D 模块最接近 Space Simulator 的视觉锚点。",
    radius: 52,
    size: 0.92,
    periodDays: 10759,
    phaseDays: 123,
    eccentricity: 0.0565,
    argumentOfPeriapsisDeg: 339.4,
    inclinationDeg: 2.5,
    ascendingNodeDeg: 113.7,
    selfSpin: 0.0031,
    texture: TEXTURE_FILES.saturn,
    roughness: 0.92,
    ring: {
      innerRadius: 2.05,
      outerRadius: 3.52,
      texture: TEXTURE_FILES.saturnRing,
      rotationZ: 0.18,
    },
    haloColor: 0xf7d2a2,
    haloOpacity: 0.12,
    haloScale: 7.2,
    focusDistance: 7.4,
  });
  registerStaticBody({
    id: "moon-titan",
    name: "土卫六",
    sceneLabel: "土卫六",
    group: "moon",
    location: "土星系统",
    diameter: "5,149 km",
    speed: "5.57 km/s",
    nearest: "1,221,870 km",
    description: "土卫六用暖色大气感补足土星系统的层级，让近景更像真正的空间模拟器。",
    orbitCenterId: "planet-saturn",
    radius: 2.05,
    size: 0.14,
    periodDays: 15.95,
    phaseDays: 45,
    eccentricity: 0.0288,
    argumentOfPeriapsisDeg: 186,
    inclinationDeg: 0.3,
    ascendingNodeDeg: 35,
    selfSpin: 0.0009,
    texture: TEXTURE_FILES.moon,
    tint: 0xe9b16d,
    roughness: 0.94,
    atmosphereColor: 0xf0a85d,
    atmosphereOpacity: 0.08,
    atmosphereScale: 1.06,
    haloColor: 0xf0c48d,
    haloOpacity: 0.06,
    haloScale: 1.8,
    focusDistance: 3.4,
  });
  registerStaticBody({
    id: "moon-iapetus",
    name: "土卫八",
    sceneLabel: "土卫八",
    group: "moon",
    location: "土星系统",
    diameter: "1,470 km",
    speed: "3.26 km/s",
    nearest: "3,560,820 km",
    description: "用明暗双色表面对齐你给的 Celestia 参考图，让土卫八近景不再只是普通灰球。",
    orbitCenterId: "planet-saturn",
    radius: 3.1,
    size: 0.1,
    periodDays: 79.3,
    phaseDays: 12,
    eccentricity: 0.0283,
    argumentOfPeriapsisDeg: 87.1,
    inclinationDeg: 15.5,
    ascendingNodeDeg: -20,
    selfSpin: 0.00025,
    texture: iapetusTexture,
    roughness: 0.96,
    haloColor: 0xe7ddd1,
    haloOpacity: 0.04,
    haloScale: 1.55,
    focusDistance: 3.0,
  });
  // 天王星与海王星仅在示意比例中做可视化占位，实际比例模式下使用真实尺度数据呈现 Celestia 风格。
  registerStaticBody({
    id: "planet-uranus",
    name: "天王星",
    sceneLabel: "天王星",
    location: "外太阳系 / 第七轨道",
    diameter: "50,724 km",
    speed: "6.80 km/s",
    description: "冰巨星，公转轴近乎侧躺，实际比例模式下能观察到它远离内行星的真实距离。",
    radius: 78,
    size: 0.52,
    periodDays: 30688,
    phaseDays: 184,
    eccentricity: 0.0457,
    argumentOfPeriapsisDeg: 96.99,
    inclinationDeg: 0.77,
    ascendingNodeDeg: 74.0,
    selfSpin: 0.0021,
    texture: TEXTURE_FILES.mercury,
    tint: 0x9ee6f2,
    roughness: 0.62,
    atmosphereColor: 0x7ce2f0,
    atmosphereOpacity: 0.16,
    atmosphereScale: 1.08,
    haloColor: 0x9bf0ff,
    haloOpacity: 0.1,
    haloScale: 5.4,
    focusDistance: 5.2,
  });
  registerStaticBody({
    id: "planet-neptune",
    name: "海王星",
    sceneLabel: "海王星",
    location: "外太阳系 / 第八轨道",
    diameter: "49,244 km",
    speed: "5.43 km/s",
    description: "太阳系最外层的大行星，开启实际比例后会真实地退后到视野边缘。",
    radius: 100,
    size: 0.5,
    periodDays: 60182,
    phaseDays: 220,
    eccentricity: 0.0113,
    argumentOfPeriapsisDeg: 273.2,
    inclinationDeg: 1.77,
    ascendingNodeDeg: 131.8,
    selfSpin: 0.0022,
    texture: TEXTURE_FILES.mercury,
    tint: 0x4f7af2,
    roughness: 0.58,
    atmosphereColor: 0x6c9cff,
    atmosphereOpacity: 0.2,
    atmosphereScale: 1.09,
    haloColor: 0x7ca5ff,
    haloOpacity: 0.12,
    haloScale: 5.8,
    focusDistance: 5.0,
  });

  // Celestia 风格 point display marker：为每个天体创建一个附加的发光精灵，
  // 在 animate() 中按相机距离动态保持恒定屏幕像素大小，使远视角下可以看到太阳和行星之间悬殊的尺度差异。
  // 近视角下 marker 会自动淡出，让真实几何接管。
  const bodyDisplayMarkerTexture = createGlowTexture("rgba(255,255,255,0.98)", "rgba(255,255,255,0)");
  const bodyDisplayMarkers = {};
  const sunDisplayHaloMarker = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: bodyDisplayMarkerTexture,
      color: REAL_BODY_MARKER["sun-core"].haloColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sunDisplayHaloMarker.renderOrder = 4;
  sunDisplayHaloMarker.visible = false;
  sunDisplayHaloMarker.scale.setScalar(1);
  scene.add(sunDisplayHaloMarker);
  Object.keys(REAL_BODY_MARKER).forEach((bodyId) => {
    const cfg = REAL_BODY_MARKER[bodyId];
    const marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: bodyDisplayMarkerTexture,
        color: cfg.color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      })
    );
    marker.renderOrder = 5;
    marker.visible = false;
    marker.scale.setScalar(1);
    // id 用于 raycaster 的 userData.id 解析，让远视角下「点击发光点」等同于点击该行星/天体。
    marker.userData = { id: bodyId, targetPx: cfg.px, isBodyMarker: true };
    scene.add(marker);
    bodyDisplayMarkers[bodyId] = marker;
  });

  const selectedMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.68, 48),
    new THREE.MeshBasicMaterial({ color: 0x9be5ff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
  );
  selectedMarker.visible = false;
  selectedMarker.rotation.x = Math.PI / 2;
  scene.add(selectedMarker);
  const velocityArrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    3,
    0xffcc66,
    0.9,
    0.55
  );
  velocityArrow.visible = false;
  scene.add(velocityArrow);
  const selectionGlowTexture = createGlowTexture("rgba(147,231,255,0.96)", "rgba(96,177,255,0.08)");
  const selectedBeacon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: selectionGlowTexture,
      color: 0x9ce9ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  selectedBeacon.visible = false;
  selectedBeacon.scale.set(4.4, 4.4, 1);
  scene.add(selectedBeacon);
  const starPositions = [];
  const starColors = [];
  for (let i = 0; i < 900; i += 1) {
    const radius = 210 + Math.random() * 210;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions.push(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius * 0.52,
      Math.sin(phi) * Math.sin(theta) * radius
    );
    const tint = 0.65 + Math.random() * 0.35;
    starColors.push(0.5 * tint, 0.72 * tint, 1 * tint);
  }
  const starfieldGeometry = new THREE.BufferGeometry();
  starfieldGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
  starfieldGeometry.setAttribute("color", new THREE.Float32BufferAttribute(starColors, 3));
  const starfield = new THREE.Points(
    starfieldGeometry,
    new THREE.PointsMaterial({
      size: 0.1,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(starfield);
  const kuiperPositions = [];
  for (let i = 0; i < 860; i += 1) {
    const radius = 128 + Math.random() * 42;
    const angle = Math.random() * Math.PI * 2;
    const y = (Math.random() - 0.5) * 5.2;
    kuiperPositions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }
  const kuiperGeometry = new THREE.BufferGeometry();
  kuiperGeometry.setAttribute("position", new THREE.Float32BufferAttribute(kuiperPositions, 3));
  const kuiperField = new THREE.Points(
    kuiperGeometry,
    new THREE.PointsMaterial({
      color: 0x8fbde8,
      size: 0.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(kuiperField);
  const oortPositions = [];
  for (let i = 0; i < 560; i += 1) {
    const radius = 300 + Math.random() * 220;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    oortPositions.push(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius * 0.72,
      Math.sin(phi) * Math.sin(theta) * radius
    );
  }
  const oortGeometry = new THREE.BufferGeometry();
  oortGeometry.setAttribute("position", new THREE.Float32BufferAttribute(oortPositions, 3));
  const oortCloud = new THREE.Points(
    oortGeometry,
    new THREE.PointsMaterial({
      color: 0xa8d7ff,
      size: 0.09,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  scene.add(oortCloud);
  const selectedAuraGeometry = new THREE.BufferGeometry();
  selectedAuraGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(72 * 3), 3));
  const selectedAura = new THREE.Points(
    selectedAuraGeometry,
    new THREE.PointsMaterial({
      color: 0x93e7ff,
      size: 0.22,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  selectedAura.visible = false;
  scene.add(selectedAura);
  const trailPointCount = 48;
  const selectedTrailGeometry = new THREE.BufferGeometry();
  selectedTrailGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(trailPointCount * 3), 3));
  const selectedTrail = new THREE.Line(
    selectedTrailGeometry,
    new THREE.LineBasicMaterial({
      color: 0x8cdeff,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  selectedTrail.visible = false;
  scene.add(selectedTrail);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0.6;
  const mouse = new THREE.Vector2();
  let previewTick = 0;

  function safeParseJson(raw, fallback) {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function parseDateLoose(raw) {
    if (!raw) return new Date();
    const normalized = String(raw).replace("Mar-", "Mar ").replace("Apr-", "Apr ");
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
    return new Date();
  }

  function setStatusBar(message, tone = "ok") {
    if (!statusBar) return;
    statusBar.textContent = message;
    if (tone) {
      statusBar.dataset.tone = tone;
    } else {
      delete statusBar.dataset.tone;
    }
  }

  function setUiState(nextState) {
    state.uiState = nextState;
    if (overviewSectionEl) {
      overviewSectionEl.dataset.state = nextState;
    }
  }

  function updateOrbitToggleButton() {
    if (!orbitToggleBtn) return;
    orbitToggleBtn.textContent = state.orbitsVisible ? "轨道显示" : "轨道隐藏";
    orbitToggleBtn.dataset.active = state.orbitsVisible ? "1" : "0";
  }

  function getCurrentUtcDays() {
    return Date.now() / 86400000 + state.timelineOffset;
  }

  function getSimulatedDate() {
    return new Date(Date.now() + state.timelineOffset * 86400000);
  }

  function getOrbitAngle(periodDays, phaseDays = 0) {
    const days = getCurrentUtcDays() + phaseDays;
    const normalized = ((days / periodDays) % 1 + 1) % 1;
    return normalized * Math.PI * 2;
  }

  function getObjectWorldPosition(object, target = new THREE.Vector3()) {
    if (!object) return target.set(0, 0, 0);
    return object.getWorldPosition(target);
  }

  function formatDateTime(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
  }

  function getCardImage(item) {
    if (item.image) return item.image;
    if (!state.cardImageMap[item.id]) {
      const randomIndex = Math.floor(Math.random() * METEOR_IMAGE_POOL.length);
      state.cardImageMap[item.id] = METEOR_IMAGE_POOL[randomIndex];
    }
    return state.cardImageMap[item.id];
  }

  // 在远端图片（如 Wikipedia 上的缩略图）偶发 404 时，降级到 Unsplash 图池，避免卡片图框空着。
  function getCardFallbackImage(item) {
    const key = `${item.id}::fallback`;
    if (!state.cardImageMap[key]) {
      const randomIndex = Math.floor(Math.random() * METEOR_IMAGE_POOL.length);
      state.cardImageMap[key] = METEOR_IMAGE_POOL[randomIndex];
    }
    return state.cardImageMap[key];
  }

  function getExploreLinks(item) {
    const query = encodeURIComponent(`${item.name} ${item.location || ""} meteorite`);
    const queryZh = encodeURIComponent(`${item.name} 陨石 介绍`);
    return [
      {
        group: "搜索入口",
        links: [
          { name: "Google 介绍搜索", hint: "百科 / 新闻 / 学术页面", url: `https://www.google.com/search?q=${query}` },
          { name: "百度中文搜索", hint: "中文图文科普与资讯", url: `https://www.baidu.com/s?wd=${queryZh}` },
        ],
      },
      {
        group: "视频入口",
        links: [
          { name: "YouTube 视频", hint: "英文讲解与纪录片", url: `https://www.youtube.com/results?search_query=${query}` },
          { name: "Bilibili 视频", hint: "中文解说与天文科普", url: `https://search.bilibili.com/all?keyword=${queryZh}` },
        ],
      },
      {
        group: "专业入口",
        links: [
          { name: "权威来源页面", hint: "数据库或官方页面", url: item.source || "https://www.lpi.usra.edu/meteor/" },
          { name: "NASA Planetary Defense", hint: "近地体监测背景与知识", url: "https://science.nasa.gov/planetary-defense/" },
        ],
      },
    ];
  }

  function openCardModal(item) {
    modalTitleEl.textContent = `${item.name} · 深入了解`;
    modalDescEl.textContent =
      item.description ||
      "该目标暂无详细描述，建议通过下方搜索入口查看科普网站、视频平台和权威数据库。";
    const links = getExploreLinks(item);
    modalLinksEl.innerHTML = links
      .map(
        (group) => `
          <section class="modal-group">
            <h4>${group.group}</h4>
            <div class="modal-group-list">
              ${group.links
                .map(
                  (link) => `
                    <a class="modal-link" href="${link.url}" target="_blank" rel="noreferrer">
                      <span class="name">${link.name}</span>
                      <span class="hint">${link.hint}</span>
                    </a>
                  `
                )
                .join("")}
            </div>
          </section>
        `
      )
      .join("");
    cardModalEl.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeCardModal() {
    cardModalEl.hidden = true;
    document.body.style.overflow = "";
  }

  function loadStoredState() {
    try {
      const favorites = safeParseJson(localStorage.getItem(STORAGE_KEYS.favorites) || "[]", []);
      const subscriptions = safeParseJson(localStorage.getItem(STORAGE_KEYS.subscriptions) || "[]", []);
      state.favorites = new Set(Array.isArray(favorites) ? favorites : []);
      state.subscriptions = Array.isArray(subscriptions) ? subscriptions : [];
    } catch {
      state.favorites = new Set();
      state.subscriptions = [];
    }
  }

  function persistStoredState() {
    try {
      localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify(Array.from(state.favorites)));
      localStorage.setItem(STORAGE_KEYS.subscriptions, JSON.stringify(state.subscriptions));
    } catch {
      // 隐私模式下可能禁止本地存储，静默降级为会话内状态。
    }
  }

  function formatSelectedFacts(item) {
    const rows = [
      ["类别", item.type || "-"],
      ["地点/轨道", item.location || "-"],
      ["直径", item.diameter || "-"],
      ["最近接近", item.nearest || "-"],
    ];
    return rows
      .map(
        ([k, v]) => `
          <div class="selected-fact">
            <span class="selected-fact-label">${k}</span>
            <span class="selected-fact-value">${v}</span>
          </div>
        `
      )
      .join("");
  }

  function updateActionButtons() {
    if (!state.selected) return;
    const isFav = state.favorites.has(state.selected.id);
    favoriteBtn.textContent = isFav ? "取消收藏" : "加入收藏";
    compareBtn.textContent = `加入对比（${state.compare.size}/3）`;
  }

  function renderSourceStatus() {
    if (!state.sourceStatus?.sources) {
      sourceStatusEl.innerHTML = "";
      return;
    }
    const labels = {
      nasaFeed: "NASA Feed",
      nasaBrowse: "NASA Browse",
      notableLocal: "本地图鉴",
      neoLocalFallback: "本地兜底",
    };
    sourceStatusEl.innerHTML = Object.entries(labels)
      .map(([key, label]) => {
        const src = state.sourceStatus.sources[key] || { ok: false, detail: "-" };
        return `<span class="source-chip ${src.ok ? "ok" : "bad"}">${label}: ${src.ok ? "OK" : "FAIL"}</span>`;
      })
      .join("");
  }

  function renderPreview(target, item) {
    if (!target) return;
    target.innerHTML = item
      ? formatSelectedFacts(item)
      : `
          <div class="selected-fact">
            <span class="selected-fact-label">状态</span>
            <span class="selected-fact-value">暂无数据</span>
          </div>
        `;
  }

  function formatMissDistance(item) {
    return item?.metrics?.missKm ? `${Math.round(item.metrics.missKm).toLocaleString()} km` : "-";
  }

  function formatMissDistanceDetailed(item) {
    const km = Number(item?.metrics?.missKm);
    if (!km) return "-";
    const au = km / 149597870.7;
    const auText = au >= 0.01 ? au.toFixed(3) : au.toFixed(4);
    return `${Math.round(km).toLocaleString()} km（${auText} AU）`;
  }

  function getPriorityNarrative(item) {
    if (state.uiState === "loading") {
      return "正在加载监测数据，场景与重点目标会在就绪后自动更新。";
    }
    if (state.uiState === "degraded") {
      return "当前以简化太阳系与缓存目标继续服务，仍可浏览重点对象与图鉴内容。";
    }
    if (state.uiState === "error") {
      return "实时数据暂不可达，建议稍后重试，或先查看完整目标列表。";
    }
    if (state.uiState === "empty") {
      return "当前没有首页重点目标，场景仍保留基础太阳系认知与后续入口。";
    }
    if (!item) return "点击卡片或场景节点后，这里会显示该目标的重点说明。";
    if (item.group === "planet" || item.group === "moon") {
      return "当前选中的是太阳系基准天体，用来建立真实空间尺度、轨道关系与近景观察参照。";
    }
    if (item.metrics?.hazardous) {
      return "当前对象位于优先监测序列内，需要持续关注轨道变化与风险等级。";
    }
    if (item.type?.includes("彗星")) {
      return "该目标以观测与科普价值为主，适合在总览中快速理解其轨迹与可见性。";
    }
    if (item.type?.includes("陨石")) {
      return "该条目主要承担科普解释作用，帮助建立真实案例与监测目标的联系。";
    }
    return "当前对象在近地轨道带内具有较高监测优先级，适合作为首页重点目标持续观察。";
  }

  function renderSelectedSummary() {
    if (selectedNameEl) {
      selectedNameEl.textContent = state.selected?.name || "--";
    }
    if (selectedCopyEl) {
      selectedCopyEl.textContent = getPriorityNarrative(state.selected);
    }
    if (selectedMetricsEl) {
      if (!state.selected) {
        selectedMetricsEl.textContent = "最近距离 -- · 速度 -- · 风险 --";
      } else {
        selectedMetricsEl.textContent = `最近距离 ${formatMissDistanceDetailed(state.selected)} · 速度 ${state.selected.speed || "-"} · 风险 ${state.selected.risk || "-"}`;
      }
    }
    renderPreview(selectedPreviewEl, state.selected);
  }

  function renderLoadingModule() {
    setUiState("loading");
    if (featuredTargetsEl) {
      featuredTargetsEl.innerHTML = Array.from({ length: 3 }, () => `
        <div class="featured-card featured-card-skeleton" aria-hidden="true">
          <span class="featured-card-title skeleton-line skeleton-line-lg"></span>
          <span class="featured-card-desc skeleton-line skeleton-line-md"></span>
          <span class="featured-card-meta skeleton-line skeleton-line-sm"></span>
        </div>
      `).join("");
    }
    renderSelectedSummary();
    if (degradedHintTextEl) {
      degradedHintTextEl.textContent = "正在加载太阳系监测数据，稍后将展示 3D 场景、重点目标与状态说明。";
    }
    if (retryDataBtn) {
      retryDataBtn.hidden = true;
    }
  }

  function renderFeaturedTargets() {
    if (!featuredTargetsEl) return;
    if (state.uiState === "loading") {
      renderLoadingModule();
      return;
    }
    const sorted = getSortedDisplayList();
    const items = sorted.slice(0, Math.min(12, sorted.length));
    if (!items.length) {
      featuredTargetsEl.innerHTML = `<p class="compare-empty">暂无重点目标，等待数据载入。</p>`;
      return;
    }
    featuredTargetsEl.innerHTML = items
      .map((item) => {
        const selected = state.selected?.id === item.id;
        return `
          <button class="featured-card ${selected ? "is-selected" : ""}" data-featured-id="${item.id}" type="button">
            <span class="featured-card-title">${item.name}</span>
            <span class="featured-card-desc">${item.type || "-"} · ${item.description || "暂无摘要。"}</span>
            <span class="featured-card-meta">最近距离 ${formatMissDistance(item)} · 速度 ${item.speed || "-"} · 风险 ${item.risk || "-"}</span>
          </button>
        `;
      })
      .join("");
  }

  function applyOrbitHighlightState() {
    const isReal = state.viewMode === "realistic";
    Object.entries(state.orbitLines).forEach(([lineId, line]) => {
      const isSelected = lineId === state.selectedOrbitId;
      const isHovered = lineId === state.hoveredId && !isSelected;
      // 行星轨道（id 以 planet- 开头）视作「常显结构线」：实际比例下稀疏巨大，默认太暗会看不见，
      // 所以在 realistic 模式下把未选中的行星轨道线默认亮度从 0.18 提到 0.55，并给一个更明显的冷青色。
      const isPlanetOrbit = typeof lineId === "string" && lineId.startsWith("planet-");
      line.visible = state.orbitsVisible;
      if (isSelected) {
        line.material.opacity = 0.92;
        line.material.color.setHex(0xff7168);
      } else if (isHovered) {
        line.material.opacity = isPlanetOrbit ? 0.75 : 0.42;
        line.material.color.setHex(0xb7ff8f);
      } else if (isPlanetOrbit) {
        line.material.opacity = isReal ? 0.55 : 0.32;
        line.material.color.setHex(isReal ? 0x7cc4ff : 0x4a9a5c);
      } else {
        line.material.opacity = 0.18;
        line.material.color.setHex(0x3c7a45);
      }
    });
    Object.entries(state.meshes).forEach(([meshId, mesh]) => {
      // 真实比例下 meteor marker 是 Sprite（无 emissive），scale 由 animate() 按相机距离管理，这里不要去动。
      if (mesh.userData?.isMeteorMarker) return;
      if (mesh.material?.emissive) {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
      mesh.scale.setScalar(1);
    });
    Object.entries(planetMeshes).forEach(([meshId, mesh]) => {
      const baseEmissive = Number(mesh.userData.baseEmissiveIntensity || 0);
      mesh.material.emissive.setHex(0xffffff);
      mesh.material.emissiveIntensity = baseEmissive;
      mesh.scale.setScalar(1);
    });
    state.orbitTickMeshes.forEach((tick) => {
      tick.visible = state.orbitsVisible;
      tick.material.opacity = tick.userData.orbitId === state.selectedOrbitId ? 0.95 : 0.35;
    });
  }

  function getStaticBodyById(id) {
    const mesh = planetMeshes[id];
    return mesh ? mesh.userData : null;
  }

  function getItemById(id) {
    return (
      state.displayList.find((it) => it.id === id) ||
      state.searchResults.find((it) => it.id === id) ||
      getStaticBodyById(id) ||
      null
    );
  }

  function cardTemplate(item) {
    const image = getCardImage(item);
    const fallback = getCardFallbackImage(item);
    const isFav = state.favorites.has(item.id);
    const favMark = isFav ? "★ 已收藏" : "";
    const canLocate = Boolean(getSceneMeshById(item.id));
    return `
      <article class="meteor-card" data-open-id="${item.id}">
        <img src="${image}" alt="${item.name}" loading="lazy" onerror="this.onerror=null;this.src='${fallback}';" />
        <div class="meteor-card-content">
          <h4>${item.name} ${favMark ? `<span class="meta-inline">${favMark}</span>` : ""}</h4>
          <p class="meta">${item.type} · ${item.location || "-"} · ${item.year || "-"}</p>
          <p>${item.description || "暂无详细说明。"}</p>
          <p class="meta">来源：<a href="${item.source || "https://cneos.jpl.nasa.gov/"}" target="_blank" rel="noreferrer">查看原始数据</a></p>
          <button class="ghost-btn small select-card-btn" data-id="${item.id}" ${canLocate ? "" : "disabled"}>
            ${canLocate ? "在 3D 视图中定位" : "资料卡（无轨道）"}
          </button>
        </div>
      </article>
    `;
  }

  function getSortedDisplayList() {
    return [...state.displayList].sort((a, b) => {
      const hazardA = a.metrics?.hazardous ? 1 : 0;
      const hazardB = b.metrics?.hazardous ? 1 : 0;
      if (hazardA !== hazardB) return hazardB - hazardA;
      const missA = Number(a.metrics?.missKm || Number.MAX_SAFE_INTEGER);
      const missB = Number(b.metrics?.missKm || Number.MAX_SAFE_INTEGER);
      return missA - missB;
    });
  }

  function renderCards() {
    const type = typeFilterEl.value;
    // 图鉴（Archive）的核心定位是"著名陨石"，所以在非搜索态下先展示历史陨石，再追加实时 NEO（按危险度 / 最近距离排序）。
    let sourceList;
    if (state.searchMode) {
      sourceList = state.searchResults;
    } else {
      const notableList = state.notable || [];
      const neoSorted = [...(state.neo || [])].sort((a, b) => {
        const hazardA = a.metrics?.hazardous ? 1 : 0;
        const hazardB = b.metrics?.hazardous ? 1 : 0;
        if (hazardA !== hazardB) return hazardB - hazardA;
        const missA = Number(a.metrics?.missKm || Number.MAX_SAFE_INTEGER);
        const missB = Number(b.metrics?.missKm || Number.MAX_SAFE_INTEGER);
        return missA - missB;
      });
      sourceList = [...notableList, ...neoSorted];
    }
    const list = sourceList.filter((item) => {
      const passType = type === "all" || item.type === type;
      return passType;
    });
    const capped = state.searchMode ? list.slice(0, 6) : list.slice(0, Math.min(18, list.length));
    if (!capped.length) {
      meteorGridEl.innerHTML = `<article class="panel-block"><p class="meta">未找到匹配结果，请尝试更换关键词或类型。</p></article>`;
      return;
    }
    if (!state.searchMode) {
      meteorGridEl.innerHTML = capped.map(cardTemplate).join("");
      return;
    }
    const groups = ["事件复盘", "轨道动力学", "观测地点"];
    const grouped = new Map(groups.map((g) => [g, []]));
    capped.forEach((item) => {
      const key = groups.includes(item.viewGroup) ? item.viewGroup : "观测地点";
      grouped.get(key).push(item);
    });
    const chunks = groups
      .map((group) => {
        const items = grouped.get(group);
        if (!items || !items.length) return "";
        return `
          <section class="search-group">
            <h3 class="search-group-title">${group}</h3>
            <div class="search-group-grid">
              ${items.map(cardTemplate).join("")}
            </div>
          </section>
        `;
      })
      .join("");
    meteorGridEl.innerHTML = chunks;
  }

  function localSearchFallback(keyword, type) {
    const lowered = keyword.toLowerCase();
    const combined = getSortedDisplayList();
    return combined
      .filter((item) => {
        if (type !== "all" && item.type !== type) return false;
        const text = `${item.name} ${item.type} ${item.location} ${item.description}`.toLowerCase();
        return lowered
          .split(/\s+/)
          .filter(Boolean)
          .every((token) => text.includes(token));
      })
      .slice(0, 6);
  }

  async function runSearch() {
    const keyword = searchInputEl.value.trim();
    const type = typeFilterEl.value;
    state.searchQuery = keyword;
    if (!keyword) {
      state.searchMode = false;
      state.searchResults = [];
      setStatusBar("已清空搜索，显示默认图鉴列表。", "ok");
      renderCards();
      return;
    }
    setStatusBar(`正在搜索“${keyword}”...`, "warn");
    try {
      const query = new URLSearchParams({
        q: keyword,
        limit: "6",
        type,
      });
      const res = await fetch(`/api/search?${query.toString()}`);
      if (!res.ok) throw new Error(`搜索请求失败: ${res.status}`);
      const json = await res.json();
      state.searchMode = true;
      state.searchResults = Array.isArray(json.data) ? json.data.slice(0, 6) : [];
      renderCards();
      setStatusBar(`搜索完成：共 ${state.searchResults.length} 条（最多展示 6 条）`, "ok");
    } catch {
      state.searchMode = true;
      state.searchResults = localSearchFallback(keyword, type);
      renderCards();
      setStatusBar(`远端搜索暂不可用，已使用本地检索结果 ${state.searchResults.length} 条。`, "warn");
    }
  }

  function inferRiskLevel(item) {
    if (!item) return "low";
    if (item.metrics?.hazardous) return "high";
    const text = String(item.risk || "").toLowerCase();
    if (text.includes("high") || text.includes("高")) return "high";
    if (text.includes("medium") || text.includes("中")) return "medium";
    return "low";
  }

  function renderCompareBoard() {
    const ids = Array.from(state.compare).slice(0, 3);
    if (!ids.length) {
      compareBoardEl.classList.add("is-empty");
      compareBoardEl.innerHTML = `<p class="compare-empty">还没有加入对象。先在右侧面板点击"加入对比"。</p>`;
      compareBtn.textContent = `加入对比（0/3）`;
      return;
    }
    compareBoardEl.classList.remove("is-empty");
    const items = ids
      .map((id) => getItemById(id))
      .filter(Boolean);
    compareBoardEl.innerHTML = items
      .map((item) => {
        const risk = inferRiskLevel(item);
        const missKm = Number(item.metrics?.missKm);
        const missText = missKm ? `${Math.round(missKm).toLocaleString()} km` : "-";
        const riskLabel = item.risk || (risk === "high" ? "高" : risk === "medium" ? "中" : "常规");
        return `
      <article class="compare-card" data-risk="${risk}" data-id="${item.id}">
        <div class="compare-card-head">
          <span class="compare-card-type">${item.type || "未分类"}</span>
          <span class="compare-risk-tag" data-risk="${risk}">风险 · ${riskLabel}</span>
        </div>
        <h3 class="compare-card-title">${item.name}</h3>
        <div class="compare-card-kv">
          <div class="compare-card-kv-item">
            <span class="compare-card-kv-label">直径</span>
            <span class="compare-card-kv-value">${item.diameter || "-"}</span>
          </div>
          <div class="compare-card-kv-item">
            <span class="compare-card-kv-label">速度</span>
            <span class="compare-card-kv-value">${item.speed || "-"}</span>
          </div>
          <div class="compare-card-kv-item">
            <span class="compare-card-kv-label">最近距离</span>
            <span class="compare-card-kv-value">${missText}</span>
          </div>
          <div class="compare-card-kv-item">
            <span class="compare-card-kv-label">地点 / 轨道</span>
            <span class="compare-card-kv-value">${item.location || "-"}</span>
          </div>
        </div>
        <div class="compare-card-footer">
          <button class="ghost-btn small remove-compare-btn" data-id="${item.id}">移除</button>
        </div>
      </article>`;
      })
      .join("");
    compareBtn.textContent = `加入对比（${items.length}/3）`;
  }

  function renderFavorites() {
    const ids = Array.from(state.favorites);
    const countEl = document.getElementById("favorites-count");
    if (countEl) countEl.textContent = String(ids.length);
    if (!ids.length) {
      favoritesListEl.innerHTML = `
        <li class="panel-block-empty">
          <span class="panel-block-empty-icon" aria-hidden="true">★</span>
          <span class="panel-block-empty-title">暂无收藏对象</span>
          <span class="panel-block-empty-hint">在 Selected Target 里点 "加入收藏" 即可保存到本地。</span>
        </li>`;
      return;
    }
    favoritesListEl.innerHTML = ids
      .map((id) => {
        const item = getItemById(id);
        const title = item ? item.name : `${id}（今日无数据）`;
        const risk = inferRiskLevel(item);
        const meta = item
          ? `${item.type || "未分类"} · ${item.diameter || "尺寸未知"}`
          : "等待数据载入";
        return `
          <li class="list-item">
            <div class="list-item-main">
              <span class="list-item-title-row">
                <span class="list-item-dot" data-risk="${risk}" aria-hidden="true"></span>
                <span class="list-item-title">${title}</span>
              </span>
              <span class="meta-inline">${meta}</span>
            </div>
            <div class="list-item-actions">
              <button class="ghost-btn small action-jump jump-favorite-btn" data-id="${id}">定位</button>
              <button class="ghost-btn small action-remove remove-favorite-btn" data-id="${id}">移除</button>
            </div>
          </li>
        `;
      })
      .join("");
  }

  function renderSubscriptions() {
    const countEl = document.getElementById("subscriptions-count");
    if (countEl) countEl.textContent = String(state.subscriptions.length);
    if (!state.subscriptions.length) {
      subscriptionsListEl.innerHTML = `
        <li class="panel-block-empty">
          <span class="panel-block-empty-icon" aria-hidden="true">◉</span>
          <span class="panel-block-empty-title">暂无订阅提醒</span>
          <span class="panel-block-empty-hint">在 Selected Target 里点 "订阅提醒"，距离触达阈值时会高亮告警。</span>
        </li>`;
      return;
    }
    subscriptionsListEl.innerHTML = state.subscriptions
      .map((sub) => {
        const item = getItemById(sub.id);
        const missKm = Number(item?.metrics?.missKm || Infinity);
        const hit = Number.isFinite(missKm) && missKm <= sub.threshold;
        const name = item?.name || `${sub.id}（今日无数据）`;
        const distanceText = Number.isFinite(missKm) ? `${Math.round(missKm).toLocaleString()} km` : "暂无距离";
        const risk = hit ? "high" : inferRiskLevel(item);
        const metaText = `阈值 ${Number(sub.threshold).toLocaleString()} km · 当前 ${distanceText}`;
        return `
          <li class="list-item ${hit ? "hit" : ""}">
            <div class="list-item-main">
              <span class="list-item-title-row">
                <span class="list-item-dot" data-risk="${risk}" aria-hidden="true"></span>
                <span class="list-item-title">${name}</span>
                ${hit ? '<span class="hit-badge" aria-label="已命中阈值">命中</span>' : ""}
              </span>
              <span class="meta-inline">${metaText}</span>
            </div>
            <div class="list-item-actions">
              <button class="ghost-btn small action-jump jump-sub-btn" data-id="${sub.id}">定位</button>
              <button class="ghost-btn small action-remove remove-sub-btn" data-id="${sub.id}">取消</button>
            </div>
          </li>
        `;
      })
      .join("");
  }

  function renderAllPanels() {
    renderSelectedSummary();
    renderFeaturedTargets();
    renderCompareBoard();
    renderFavorites();
    renderSubscriptions();
    renderCards();
    updateActionButtons();
  }

  function toDateYMD(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + Math.round(offsetDays));
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
  }

  function formatTimelineOffset(offset) {
    const rounded = Math.abs(offset) >= 100 ? Math.round(offset) : Math.round(offset * 10) / 10;
    return rounded === 0 ? "T+0 天" : rounded > 0 ? `T+${rounded} 天` : `T${rounded} 天`;
  }

  function updateTimelineControls() {
    if (timelineValueEl) {
      timelineValueEl.textContent = `${formatDateTime(getSimulatedDate())} · ${formatTimelineOffset(state.timelineOffset)}`;
    }
    if (timelineSpeedEl) {
      const modeLabel =
        state.playbackDirection < 0 ? "倒放" : state.playbackDirection > 0 ? "正放" : "暂停";
      timelineSpeedEl.textContent = `${modeLabel} · ${PLAYBACK_SPEED_STEPS[state.playbackSpeedIndex]} 天/秒`;
    }
    if (timelinePlayPauseBtn) {
      timelinePlayPauseBtn.innerHTML = state.playbackDirection === 0 ? "&#9654;" : "&#10074;&#10074;";
      timelinePlayPauseBtn.setAttribute("aria-label", state.playbackDirection === 0 ? "播放" : "暂停");
      timelinePlayPauseBtn.title = state.playbackDirection === 0 ? "播放" : "暂停";
      timelinePlayPauseBtn.dataset.active = state.playbackDirection !== 0 ? "1" : "0";
    }
    if (timelineBackwardBtn) {
      timelineBackwardBtn.dataset.active = state.playbackDirection < 0 ? "1" : "0";
    }
    if (timelineForwardBtn) {
      timelineForwardBtn.dataset.active = state.playbackDirection > 0 ? "1" : "0";
    }
    if (timelineSlowerBtn) {
      timelineSlowerBtn.disabled = state.playbackSpeedIndex === 0;
    }
    if (timelineFasterBtn) {
      timelineFasterBtn.disabled = state.playbackSpeedIndex === PLAYBACK_SPEED_STEPS.length - 1;
    }
  }

  function setPlaybackDirection(direction) {
    state.playbackDirection = direction;
    updateTimelineControls();
  }

  function changePlaybackSpeed(delta) {
    const nextIndex = THREE.MathUtils.clamp(
      state.playbackSpeedIndex + delta,
      0,
      PLAYBACK_SPEED_STEPS.length - 1
    );
    if (nextIndex === state.playbackSpeedIndex) return;
    state.playbackSpeedIndex = nextIndex;
    updateTimelineControls();
  }

  function normalizeNotableForOrbit(item, index) {
    const id = item.id || `notable-${index}`;
    const seed = hashSeed(id || item.name || `notable-${index}`);
    const rand = (i) => seededRandom(seed, i);
    // 典型坠落天体的 Earth-crosser 轨道：a 1.1~1.8 AU，近日点 < 1.02 AU 以保证穿越地球轨道
    const aAU = 1.1 + rand(0) * 0.7;
    const minEcc = Math.max(0.18, 1 - 1.02 / aAU);
    const eccentricity = Math.min(0.55, minEcc + rand(1) * 0.12);
    const inclinationDeg = 3 + rand(2) * 10;
    const ascendingNodeDeg = rand(3) * 360;
    const argumentOfPeriapsisDeg = rand(4) * 360;
    const periodDays = keplerPeriodDays(aAU);
    const epochDays = epochDaysFromDate(parseDateLoose(item.year || item.nearest));
    return {
      ...item,
      id,
      orbit: {
        radius: auToScene(aAU),
        semiMajorAxisAU: aAU,
        periodDays,
        eccentricity,
        argumentOfPeriapsisDeg,
        inclinationDeg,
        ascendingNodeDeg,
        epochDays,
        size: 0.38 + (index % 3) * 0.08,
        color: 0x82ffd5,
      },
    };
  }

  function normalizeNeoForOrbit(item, index) {
    const hazardous = Boolean(item.metrics?.hazardous);
    const missKm = Math.max(Number(item.metrics?.missKm || 0), 1);
    const diameter = Math.max(Number(item.metrics?.diameterM || 10), 4);
    const seed = hashSeed(item.neoRefId || item.id || `neo-${index}`);
    const rand = (i) => seededRandom(seed, i);

    const AU_KM = 149597870.7;
    const missAU = Math.min(missKm / AU_KM, 0.5);

    // 半长轴分布：PHA 偏 Apollo；普通 NEO 覆盖 Aten/Apollo/Amor 全族
    let aAU = hazardous ? 0.9 + rand(0) * 1.3 : 0.75 + rand(0) * 1.65;
    // 贴近地球的近地事件（miss < 0.03 AU）往往是 Earth-crosser，a 收拢到 0.9~1.7 AU
    if (missAU < 0.03) {
      aAU = 0.9 + rand(6) * 0.8;
    }

    // 保证近日点 q = a(1-e) ≤ 1.05 AU，否则根本不可能成为近地天体
    const minEccForCrossing = aAU > 1.05 ? Math.max(0.05, 1 - 1.05 / aAU) : 0.05;
    const eccentricity = Math.min(0.62, minEccForCrossing + rand(1) * 0.25);
    const inclinationDeg = rand(2) * 18;
    const ascendingNodeDeg = rand(3) * 360;
    const argumentOfPeriapsisDeg = rand(4) * 360;
    const periodDays = keplerPeriodDays(aAU);
    const epochDays = epochDaysFromDate(parseDateLoose(item.nearest));

    return {
      ...item,
      orbit: {
        radius: auToScene(aAU),
        semiMajorAxisAU: aAU,
        periodDays,
        eccentricity,
        argumentOfPeriapsisDeg,
        inclinationDeg,
        ascendingNodeDeg,
        epochDays,
        size: Math.min(1.1, Math.max(0.32, 0.24 + diameter / 140)),
        color: hazardous ? 0xff8686 : 0x83aaff,
      },
    };
  }

  async function loadData(offsetDays) {
    const date = toDateYMD(offsetDays);
    renderLoadingModule();
    setStatusBar(`正在拉取 ${date} 的 NASA 近地体数据与图鉴...`, "warn");
    if (moduleUpdatedEl) {
      moduleUpdatedEl.textContent = `实时聚合更新中 · ${date}`;
    }
    if (degradedHintTextEl) {
      degradedHintTextEl.textContent = "降级提示位：当实时数据受限时，继续展示简化太阳系与缓存重点目标。";
    }
    const prevSelectedId = state.selected?.id;
    try {
      const notableController = new AbortController();
      const neoController = new AbortController();
      const timer = setTimeout(() => {
        notableController.abort();
        neoController.abort();
      }, 12000);
      const [notableResp, neoResp] = await Promise.allSettled([
        fetch("/api/notable", { signal: notableController.signal }),
        fetch(`/api/neo/today?start=${date}&end=${date}&limit=28`, { signal: neoController.signal }),
      ]);
      clearTimeout(timer);

      const notableJson =
        notableResp.status === "fulfilled" && notableResp.value.ok ? await notableResp.value.json() : { data: [] };
      const neoJson =
        neoResp.status === "fulfilled" && neoResp.value.ok ? await neoResp.value.json() : { data: [], warning: "NASA 源不可用" };

      const notableData = Array.isArray(notableJson.data) && notableJson.data.length ? notableJson.data : LOCAL_NOTABLE_FALLBACK;
      state.notable = notableData.map(normalizeNotableForOrbit);
      state.neo = (neoJson.data || []).map(normalizeNeoForOrbit);
      state.displayList = [...state.notable, ...state.neo];
      state.selected = getItemById(prevSelectedId) || state.displayList[0] || null;
      state.selectedOrbitId = state.selected?.id || null;

      if (statNeo) statNeo.textContent = String(state.neo.length);
      if (statNotable) statNotable.textContent = String(state.notable.length);
      const warning = neoJson.warning ? `（已启用兜底：${neoJson.warning}）` : "";
      const sourceTag = neoJson.source ? `source=${neoJson.source}` : "source=unknown";
      setStatusBar(
        `数据连接完成：${date} · ${sourceTag} · NASA ${state.neo.length} 条 · 图鉴 ${state.notable.length} 条 ${warning}`,
        warning ? "warn" : "ok"
      );
      setUiState(!state.displayList.length ? "empty" : warning ? "partial" : "success");
      if (moduleUpdatedEl) {
        moduleUpdatedEl.textContent = `实时聚合已更新 · ${new Date().toUTCString().slice(17, 22)} UTC`;
      }
      if (degradedHintTextEl) {
        degradedHintTextEl.textContent = !state.displayList.length
          ? "当前没有首页重点目标，基础太阳系场景仍可浏览，建议继续查看完整列表或专题页。"
          : warning
            ? `部分数据暂不可用：${neoJson.warning}。基础场景和重点目标仍可继续浏览。`
            : "当前状态良好：完整 3D、重点目标、图例与 CTA 已全部可用。";
      }
      if (retryDataBtn) {
        retryDataBtn.hidden = state.uiState !== "partial";
      }
    } catch (error) {
      setStatusBar(`数据加载失败，已降级为离线样本：${String(error.message || error)}`, "danger");
      const fallback = [
        {
          id: "fallback-1",
          name: "离线样本（示例）",
          type: "近地小天体",
          location: "离线模式",
          diameter: "10 m",
          speed: "12 km/s",
          nearest: "未知",
          risk: "未知",
          description: "当前无法连接远端数据源，建议检查网络或稍后重试。",
          source: "https://api.nasa.gov/",
          metrics: { missKm: 999999999, speedKps: 12, hazardous: false, diameterM: 10 },
        },
      ].map(normalizeNeoForOrbit);
      state.notable = LOCAL_NOTABLE_FALLBACK.map(normalizeNotableForOrbit);
      state.neo = fallback;
      state.displayList = [...state.notable, ...fallback];
      state.selected = state.displayList[0];
      state.selectedOrbitId = state.selected?.id || null;
      if (statNeo) statNeo.textContent = "1";
      if (statNotable) statNotable.textContent = String(state.notable.length);
      setUiState(state.displayList.length ? "degraded" : "error");
      if (moduleUpdatedEl) {
        moduleUpdatedEl.textContent = `实时聚合受限 · ${date}`;
      }
      if (degradedHintTextEl) {
        degradedHintTextEl.textContent = state.displayList.length
          ? "降级提示：实时数据受限，当前展示简化太阳系与本地缓存重点目标。"
          : "错误提示：当前无法获取可用目标，请稍后重试，或先浏览图鉴与完整列表。";
      }
      if (retryDataBtn) {
        retryDataBtn.hidden = false;
      }
    }
  }

  async function loadSourceStatus() {
    try {
      const res = await fetch("/api/source/status");
      if (!res.ok) throw new Error(String(res.status));
      state.sourceStatus = await res.json();
      renderSourceStatus();
    } catch {
      state.sourceStatus = null;
      renderSourceStatus();
    }
  }

  function clearMeteorMeshes() {
    Object.values(state.meshes).forEach((mesh) => {
      scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      const vs = mesh.userData && mesh.userData.visualSprite;
      if (vs) {
        scene.remove(vs);
        if (vs.material) vs.material.dispose();
      }
    });
    state.meshes = {};
    Object.values(state.orbitLines).forEach((line) => {
      scene.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    });
    state.orbitLines = {};
    state.orbitTickMeshes.forEach((tick) => {
      scene.remove(tick);
      tick.geometry.dispose();
      tick.material.dispose();
    });
    state.orbitTickMeshes = [];
  }

  function createOrbitLine(item, color) {
    const radius = item.orbit.radius;
    const eccentricity = item.orbit.eccentricity || 0;
    const argumentOfPeriapsisDeg = item.orbit.argumentOfPeriapsisDeg || 0;
    const inclinationDeg = item.orbit.inclinationDeg || 0;
    const ascendingNodeDeg = item.orbit.ascendingNodeDeg || 0;
    const periodDays = Math.max(
      20,
      Math.round(Number(item.orbit.periodDays) || 40 + radius * 3.2)
    );
    const epochDays = Number.isFinite(item.orbit.epochDays)
      ? item.orbit.epochDays
      : epochDaysFromDate(parseDateLoose(item.nearest));
    const startDate = new Date(epochDays * 86400000);
    const points = Array.from({ length: 180 }, (_, i) => {
      const a = (i / 180) * Math.PI * 2;
      return computeOrbitalPosition(
        radius,
        a,
        inclinationDeg,
        ascendingNodeDeg,
        new THREE.Vector3(),
        eccentricity,
        argumentOfPeriapsisDeg
      );
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color, opacity: 0.24, transparent: true })
    );
    line.userData = {
      id: item.id,
      startDate,
      periodDays,
      pointCount: points.length,
      radius,
      eccentricity,
      argumentOfPeriapsisDeg,
      inclinationDeg,
      ascendingNodeDeg,
      epochDays,
    };
    state.orbitLines[item.id] = line;
    scene.add(line);
  }

  function rebuildStaticOrbitLines() {
    staticOrbitConfigs.forEach((orbit) => {
      createOrbitLine(
        {
          id: orbit.id,
          nearest: new Date().toISOString(),
          orbit: {
            radius: orbit.radius,
            eccentricity: orbit.eccentricity,
            argumentOfPeriapsisDeg: orbit.argumentOfPeriapsisDeg,
            inclinationDeg: orbit.inclinationDeg,
            ascendingNodeDeg: orbit.ascendingNodeDeg,
          },
        },
        0x3d7d47
      );
      if (state.orbitLines[orbit.id]) {
        state.orbitLines[orbit.id].userData.periodDays = orbit.periodDays;
      }
    });
  }

  function rebuildOrbitTicks(itemId) {
    state.orbitTickMeshes.forEach((tick) => {
      scene.remove(tick);
      tick.geometry.dispose();
      tick.material.dispose();
    });
    state.orbitTickMeshes = [];
    const line = state.orbitLines[itemId];
    if (!line) return;
    const lineData = line.userData || {};
    const radius = Number(lineData.radius || state.displayList.find((it) => it.id === itemId)?.orbit?.radius || 0);
    if (!radius) return;
    const count = 12;
    // 轨迹刻度的世界尺寸：示意模式固定 0.08；真实模式下按轨道半径量级自适应（半径 ~150 时 tick ~0.6，半径 ~4500 时 tick ~9），
    // 否则在 1 AU 轨道上看上去是一个亚像素的点，用户根本点不到。
    const tickSize = state.viewMode === "realistic" ? THREE.MathUtils.clamp(radius * 0.004, 0.3, 12) : 0.08;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      const tick = new THREE.Mesh(
        new THREE.SphereGeometry(tickSize, 12, 12),
        // depthWrite 关掉：tick 与沿同轨道移动的陨石 sprite 共面，若 tick 写深度，陨石播放时会被周期性遮挡闪烁。
        new THREE.MeshBasicMaterial({
          color: 0x9be9ff,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
        })
      );
      tick.renderOrder = 3;
      tick.position.copy(
        computeOrbitalPosition(
          radius,
          angle,
          lineData.inclinationDeg || 0,
          lineData.ascendingNodeDeg || 0,
          tempVecA,
          lineData.eccentricity || 0,
          lineData.argumentOfPeriapsisDeg || 0
        )
      );
      const date = new Date(lineData.startDate || new Date());
      const daysPerTick = Math.max(1, Math.round((lineData.periodDays || 90) / count));
      date.setUTCDate(date.getUTCDate() + daysPerTick * i);
      tick.userData = { orbitId: itemId, timeLabel: formatDateTime(date) };
      tick.visible = state.orbitsVisible;
      state.orbitTickMeshes.push(tick);
      scene.add(tick);
    }
  }

  // 真实比例下所有 NEO / 陨石共用的 marker 光晕纹理（Celestia 风格的"低于显示下限的点标记"）。
  const meteorMarkerTexture = createGlowTexture("rgba(255,255,255,0.94)", "rgba(255,255,255,0)");
  // 陨石 marker 的 9×9 像素风格贴图：中心 1 px 不透明 + 8 px 半透明 bloom。
  // 所有陨石/NEO 共用同一张纹理（通过 SpriteMaterial.color 做 tint）。
  const meteorPixelTexture = createMeteorPixelTexture();
  // 可见 marker 的屏幕像素边长（恒定 9 px，不随选中/悬停变化）。
  const METEOR_VISUAL_PX = 9;

  function rebuildSceneObjects() {
    clearMeteorMeshes();
    rebuildStaticOrbitLines();
    const isRealScale = state.viewMode === "realistic";
    const source = state.displayList.length ? state.displayList : [];
    source.forEach((item, idx) => {
      if (!item.orbit) return;
      // 如果有记录的半长轴（AU），每次重建都按当前模式映射为场景半径，保证示意/实际切换后 NEO 轨道位置始终正确。
      if (Number.isFinite(item.orbit.semiMajorAxisAU)) {
        item.orbit.radius = auToScene(item.orbit.semiMajorAxisAU);
      }
      const inclinationDeg =
        Number.isFinite(item.orbit.inclinationDeg) ? item.orbit.inclinationDeg : ((idx % 7) - 3) * 2.1;
      const ascendingNodeDeg =
        Number.isFinite(item.orbit.ascendingNodeDeg) ? item.orbit.ascendingNodeDeg : (idx * 29) % 180;
      const eccentricity =
        Number.isFinite(item.orbit.eccentricity) ? item.orbit.eccentricity : 0.08 + (idx % 5) * 0.025;
      const argumentOfPeriapsisDeg = Number.isFinite(item.orbit.argumentOfPeriapsisDeg)
        ? item.orbit.argumentOfPeriapsisDeg
        : (idx * 37) % 360;
      const periodDays = Math.max(
        20,
        Math.round(Number(item.orbit.periodDays) || 42 + item.orbit.radius * 2.6)
      );
      const epochDays = Number.isFinite(item.orbit.epochDays)
        ? item.orbit.epochDays
        : epochDaysFromDate(parseDateLoose(item.nearest));
      // phaseDays 的目标：在 epochDays（近地日 / 坠落日，约等于近日点通过）时 angle=0
      const phaseDays = -epochDays;
      createOrbitLine(
        {
          ...item,
          orbit: {
            ...item.orbit,
            inclinationDeg,
            ascendingNodeDeg,
            eccentricity,
            argumentOfPeriapsisDeg,
            periodDays,
            epochDays,
          },
        },
        item.orbit.color
      );
      // 示意比例：继续沿用 Sphere Mesh，直接用 orbit.size 显示即可。
      // 实际比例：陨石/NEO 的真实直径 < 1 km，折合场景单位 < 1e-6；采用"双 sprite 方案"：
      //   - mesh 本体（进入 state.meshes，作为 raycaster 命中目标和数据锚点）：
      //     一个透明到不可见的"命中框" sprite，屏幕上仍保持原来的 16/20/24 px 大小，保证用户容易点中；
      //   - mesh.userData.visualSprite（仅做视觉展示）：
      //     恒定 9×9 像素的像素风 sprite（中心不透明 + 8 邻域半透明 bloom）。
      //   这样"好点"与"视觉精确"两个诉求解耦。
      let mesh;
      let visualSprite = null;
      if (isRealScale) {
        // 命中框：肉眼不可见，但 raycaster 仍会命中（sprite 的相交基于几何，不依赖材质颜色）。
        mesh = new THREE.Sprite(
          new THREE.SpriteMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
          })
        );
        mesh.renderOrder = 6;
        mesh.scale.setScalar(1);

        // 视觉精灵：9×9 像素风 bloom 点。像素贴图 + NearestFilter，additive blending，
        // 不参与 depth，避免被自身轨道 tick 或其它透明对象周期性遮挡产生闪烁。
        visualSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: meteorPixelTexture,
            color: item.orbit.color,
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
          })
        );
        visualSprite.renderOrder = 7;
        visualSprite.scale.setScalar(1);
        scene.add(visualSprite);
      } else {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(item.orbit.size, 15, 15),
          new THREE.MeshStandardMaterial({
            color: item.orbit.color,
            roughness: 0.36,
            metalness: 0.08,
            emissive: 0x000000,
            emissiveIntensity: 0,
          })
        );
      }
      mesh.userData = {
        id: item.id,
        periodDays,
        phaseDays,
        speed: item.orbit.speed,
        radius: item.orbit.radius,
        eccentricity,
        argumentOfPeriapsisDeg,
        inclinationDeg,
        ascendingNodeDeg,
        visualRadius: item.orbit.size,
        // 真实比例下：相机停在"能看到 Sprite marker + 周围一段轨道弧"的位置，取半长轴的 8%，同时给下限 1.2 单位避免过近。
        focusDistance: isRealScale ? Math.max(1.2, item.orbit.radius * 0.08) : null,
        isMeteorMarker: isRealScale,
        markerColor: item.orbit.color,
        visualSprite,
      };
      state.meshes[item.id] = mesh;
      scene.add(mesh);
    });
    updateOrbitToggleButton();
  }

  function getSceneMeshById(id) {
    return state.meshes[id] || planetMeshes[id] || null;
  }

  // 示意 ↔ 实际（Celestia 风格真实比例）切换。
  // 真实比例下：1 scene unit = 1,000,000 km，太阳半径 0.6957、地球半径 0.006371、地球轨道 149.598。
  function setViewMode(mode) {
    if (mode !== "schematic" && mode !== "realistic") return;
    if (state.viewMode === mode) return;
    state.viewMode = mode;
    const isReal = mode === "realistic";

    // 1. 每颗静态天体（行星 / 卫星）切换它的轨道半径、显示半径以及聚焦距离。
    staticBodies.forEach((body) => {
      const meta = body.userData;
      const modeCfg = meta.modes ? meta.modes[mode] : null;
      if (!modeCfg) return;
      meta.orbitRadius = modeCfg.orbitRadius;
      meta.radius = modeCfg.orbitRadius;
      meta.visualRadius = modeCfg.size;
      meta.focusDistance = modeCfg.focusDistance;
      const ratio = (modeCfg.size || meta.baseSize) / (meta.baseSize || 1);
      body.scale.setScalar(ratio);
    });

    // 2. 静态轨道线需要重建（半径变了，线条采样点必须重新生成）。
    staticOrbitConfigs.forEach((cfg) => {
      if (cfg.modes && cfg.modes[mode]) {
        cfg.radius = cfg.modes[mode].radius;
      }
      const existingLine = state.orbitLines[cfg.id];
      if (existingLine) {
        scene.remove(existingLine);
        existingLine.geometry.dispose();
        existingLine.material.dispose();
        delete state.orbitLines[cfg.id];
      }
    });

    // 3. 太阳与光晕。
    // 实际比例下 halo/corona 的 sprite 宽度应当 = 太阳真实半径 × 视觉系数，保证其仍比太阳本体大而不是缩到比本体还小。
    const sunRealRatio = REAL_SCALE.sunRadius / SCHEMATIC_SUN_RADIUS;
    sun.scale.setScalar(isReal ? sunRealRatio : 1);
    // visualRadius 同步更新为「当前模式下太阳的真实世界半径」，display marker 的淡出/交接逻辑依赖这个值。
    sun.userData.visualRadius = isReal ? REAL_SCALE.sunRadius : SCHEMATIC_SUN_RADIUS;
    const realHaloWidth = REAL_SCALE.sunRadius * REAL_SCALE.sunHaloScale;
    const realCoronaWidth = REAL_SCALE.sunRadius * REAL_SCALE.sunCoronaScale;
    sunHalo.scale.setScalar(isReal ? realHaloWidth : 21);
    sunCorona.scale.setScalar(isReal ? realCoronaWidth : 36);

    // 3.5 切换 Celestia display marker（仅实际比例启用）。
    Object.entries(bodyDisplayMarkers).forEach(([, marker]) => {
      marker.visible = isReal;
      marker.material.opacity = 0;
    });
    sunDisplayHaloMarker.visible = isReal;
    sunDisplayHaloMarker.material.opacity = 0;

    // 4. 光照：实际比例下 Sun 的 PointLight 需要覆盖到海王星（≈4500 单位），否则外行星漆黑一片。
    sunLight.distance = isReal ? 0 : 480;
    sunLight.intensity = isReal ? 8.5 : 4.8;
    sunLight.decay = isReal ? 0 : 1.6;

    // 5. 背景层：深空球体需要放大包住整个真实太阳系；其它星云/柯伊伯带/奥尔特云在真实比例下尺度不符，先隐藏。
    deepSpaceSphere.scale.setScalar(isReal ? 20 : 1);
    const backdropVisible = !isReal;
    starfield.visible = backdropVisible;
    kuiperField.visible = backdropVisible;
    oortCloud.visible = backdropVisible;
    nebulaSprites.forEach((s) => {
      s.visible = backdropVisible;
    });

    // 6. 迷雾：真实比例下禁用（星际间没有雾效，否则外行星会被雾吞掉）。
    scene.fog = isReal ? null : SCHEMATIC_FOG;

    // 7. 相机 + 控制器范围，适配两种量级。
    const view = isReal ? REAL_VIEW_CAMERA : SCHEMATIC_VIEW_CAMERA;
    controls.minDistance = view.minDistance;
    controls.maxDistance = view.maxDistance;

    // 8. Raycaster 对轨道线的拾取阈值（真实比例下线条稀疏，需要更宽松的阈值）。
    raycaster.params.Line.threshold = isReal ? 1.5 : 0.6;

    // 9. 选中指示器（环形 / 光斑 / 速度箭头）：在真实比例下全部缩小，避免盖住整颗行星。
    const markerScale = isReal ? 0.006 : 1;
    selectedMarker.scale.setScalar(markerScale);
    selectedBeacon.scale.setScalar(isReal ? 0.03 : 4.4);

    // 10. NEO / 陨石场景对象：重建（实际模式下会被跳过）。
    rebuildSceneObjects();

    // 11. 刷新轨道高亮，并更新按钮外观。
    applyOrbitHighlightState();
    updateScaleModeButton();

    // 12. 相机复位到当前模式的默认视角。
    resetOverviewCamera();
    if (state.selected?.id) {
      rebuildOrbitTicks(state.selected.id);
    }
  }

  function updateScaleModeButton() {
    if (!scaleModeBtn) return;
    const isReal = state.viewMode === "realistic";
    scaleModeBtn.dataset.mode = state.viewMode;
    scaleModeBtn.dataset.active = isReal ? "1" : "0";
    scaleModeBtn.textContent = isReal ? "实际比例" : "示意比例";
    scaleModeBtn.title = isReal
      ? "当前：Celestia 风格真实比例（1 AU ≈ 149.6 单位），再次点击切回示意比例"
      : "当前：示意比例（方便观察轨道关系），点击切换到 Celestia 风格真实比例";
  }

  function focusSelection(id) {
    const mesh = getSceneMeshById(id);
    if (!mesh) {
      resetOverviewCamera();
      return;
    }
    const targetPosition = getObjectWorldPosition(mesh, tempVecA);
    desiredControlTarget.copy(targetPosition);
    tempVecB.copy(camera.position).sub(controls.target);
    if (tempVecB.lengthSq() < 0.001) {
      tempVecB.set(18, 7, 20);
    }
    tempVecB.normalize();
    const focusDistance =
      mesh.userData.focusDistance ||
      THREE.MathUtils.clamp((mesh.userData.visualRadius || 1) * (mesh.userData.group === "planet" ? 8 : 10), 4.4, 18);
    desiredCameraPosition.copy(targetPosition).add(tempVecB.multiplyScalar(focusDistance));
    desiredCameraPosition.y += (mesh.userData.visualRadius || 1) * 1.1;
    focusedTargetId = id;
    focusedCameraOffset.copy(desiredCameraPosition).sub(targetPosition);
    isAutoNavigatingCamera = true;
  }

  function resetOverviewCamera() {
    const view = state.viewMode === "realistic" ? REAL_VIEW_CAMERA : SCHEMATIC_VIEW_CAMERA;
    desiredControlTarget.copy(view.target);
    desiredCameraPosition.copy(view.position);
    focusedTargetId = null;
    isAutoNavigatingCamera = true;
  }

  function selectById(id, options = {}) {
    const { focus = false } = options;
    const next = getItemById(id);
    if (!next) return;
    state.selected = next;
    state.selectedOrbitId = id;
    state.selectedTrail = [];
    renderSelectedSummary();
    renderFeaturedTargets();
    updateActionButtons();
    applyOrbitHighlightState();
    rebuildOrbitTicks(id);
    if (focus) {
      focusSelection(id);
    } else if (focusedTargetId && focusedTargetId !== id) {
      focusedTargetId = null;
    }
  }

  async function refreshForTimeline(offset) {
    setPlaybackDirection(0);
    state.timelineOffset = offset;
    updateTimelineControls();
    await loadData(offset);
    await loadSourceStatus();
    rebuildSceneObjects();
    if (state.selected?.id) selectById(state.selected.id, { focus: false });
    applyOrbitHighlightState();
    renderAllPanels();
  }

  function bindEvents() {
    controls.addEventListener("start", () => {
      isAutoNavigatingCamera = false;
      focusedTargetId = null;
      desiredControlTarget.copy(controls.target);
      desiredCameraPosition.copy(camera.position);
    });

    if (featuredTargetsEl) {
      featuredTargetsEl.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-featured-id]");
        if (!btn) return;
        // 真实比例下相机在几百单位外，不自动聚焦用户根本找不到几像素大小的 marker；参考 Celestia 的 center-selection。
        const autoFocus = state.viewMode === "realistic";
        selectById(btn.dataset.featuredId, { focus: autoFocus });
      });
      featuredTargetsEl.addEventListener("mouseover", (event) => {
        const btn = event.target.closest("[data-featured-id]");
        state.hoveredId = btn?.dataset?.featuredId || null;
        applyOrbitHighlightState();
      });
      featuredTargetsEl.addEventListener("mouseout", () => {
        state.hoveredId = null;
        applyOrbitHighlightState();
      });
      featuredTargetsEl.addEventListener("focusin", (event) => {
        const btn = event.target.closest("[data-featured-id]");
        if (!btn) return;
        state.hoveredId = btn.dataset.featuredId || null;
        applyOrbitHighlightState();
      });
      featuredTargetsEl.addEventListener("focusout", () => {
        state.hoveredId = null;
        applyOrbitHighlightState();
      });
    }

    meteorGridEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".select-card-btn");
      if (btn) {
        selectById(btn.dataset.id, { focus: true });
        document.getElementById("monitor").scrollIntoView({ behavior: "smooth" });
        return;
      }
      const card = event.target.closest("[data-open-id]");
      if (card) {
        const item = getItemById(card.dataset.openId);
        if (item) openCardModal(item);
      }
    });

    compareBoardEl.addEventListener("click", (event) => {
      const btn = event.target.closest(".remove-compare-btn");
      if (!btn) return;
      state.compare.delete(btn.dataset.id);
      renderCompareBoard();
      updateActionButtons();
    });

    favoritesListEl.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".remove-favorite-btn");
      if (removeBtn) {
        state.favorites.delete(removeBtn.dataset.id);
        persistStoredState();
        renderFavorites();
        renderCards();
        updateActionButtons();
      }
      const jumpBtn = event.target.closest(".jump-favorite-btn");
      if (jumpBtn) selectById(jumpBtn.dataset.id, { focus: true });
    });

    subscriptionsListEl.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".remove-sub-btn");
      if (removeBtn) {
        state.subscriptions = state.subscriptions.filter((sub) => sub.id !== removeBtn.dataset.id);
        persistStoredState();
        renderSubscriptions();
      }
      const jumpBtn = event.target.closest(".jump-sub-btn");
      if (jumpBtn) selectById(jumpBtn.dataset.id, { focus: true });
    });

    searchBtnEl.addEventListener("click", runSearch);
    searchInputEl.addEventListener("keydown", async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        await runSearch();
      }
    });
    typeFilterEl.addEventListener("change", async () => {
      if (state.searchMode && state.searchQuery) {
        await runSearch();
      } else {
        renderCards();
      }
    });

    compareBtn.addEventListener("click", () => {
      if (!state.selected) return;
      if (state.compare.has(state.selected.id)) return;
      if (state.compare.size >= 3) {
        setStatusBar("对比看板最多支持 3 个对象，请先移除一个。", "warn");
        return;
      }
      state.compare.add(state.selected.id);
      renderCompareBoard();
      updateActionButtons();
    });

    favoriteBtn.addEventListener("click", () => {
      if (!state.selected) return;
      if (state.favorites.has(state.selected.id)) {
        state.favorites.delete(state.selected.id);
      } else {
        state.favorites.add(state.selected.id);
      }
      persistStoredState();
      renderFavorites();
      renderCards();
      updateActionButtons();
    });

    subscribeBtn.addEventListener("click", () => {
      if (!state.selected) return;
      const existing = state.subscriptions.find((sub) => sub.id === state.selected.id);
      const threshold = existing?.threshold || DEFAULT_SUBSCRIBE_THRESHOLD_KM;
      if (existing) {
        existing.threshold = threshold;
      } else {
        state.subscriptions.push({
          id: state.selected.id,
          threshold,
          createdAt: new Date().toISOString(),
        });
      }
      persistStoredState();
      renderSubscriptions();
      setStatusBar(`已订阅 ${state.selected.name}，提醒阈值 ${threshold.toLocaleString()} km。`, "ok");
    });

    locateBtn.addEventListener("click", () => {
      if (!state.selected?.id) return;
      focusSelection(state.selected.id);
      setStatusBar(`已聚焦 ${state.selected?.name || "当前对象"}。`, "ok");
    });

    if (startTourBtn) {
      startTourBtn.addEventListener("click", () => {
        document.getElementById("monitor").scrollIntoView({ behavior: "smooth" });
      });
    }

    if (focusEarthBtn) {
      focusEarthBtn.addEventListener("click", () => {
        resetOverviewCamera();
      });
    }

    if (orbitToggleBtn) {
      orbitToggleBtn.addEventListener("click", () => {
        state.orbitsVisible = !state.orbitsVisible;
        updateOrbitToggleButton();
        applyOrbitHighlightState();
      });
    }

    if (scaleModeBtn) {
      scaleModeBtn.addEventListener("click", () => {
        const next = state.viewMode === "realistic" ? "schematic" : "realistic";
        setViewMode(next);
        setStatusBar(
          next === "realistic"
            ? "已切换到实际比例：以 Celestia 方式呈现太阳系真实尺寸与距离。"
            : "已切换到示意比例：按分段缩放方便观察各星球轨道关系。",
          "ok"
        );
      });
    }

    if (retryDataBtn) {
      retryDataBtn.addEventListener("click", async () => {
        await refreshForTimeline(Math.round(state.timelineOffset));
      });
    }

    if (timelineBackwardBtn) {
      timelineBackwardBtn.addEventListener("click", () => {
        setPlaybackDirection(-1);
      });
    }

    if (timelinePlayPauseBtn) {
      timelinePlayPauseBtn.addEventListener("click", () => {
        setPlaybackDirection(state.playbackDirection === 0 ? 1 : 0);
      });
    }

    if (timelineForwardBtn) {
      timelineForwardBtn.addEventListener("click", () => {
        setPlaybackDirection(1);
      });
    }

    if (timelineSlowerBtn) {
      timelineSlowerBtn.addEventListener("click", () => {
        changePlaybackSpeed(-1);
      });
    }

    if (timelineFasterBtn) {
      timelineFasterBtn.addEventListener("click", () => {
        changePlaybackSpeed(1);
      });
    }

    timelineResetBtn.addEventListener("click", async () => {
      state.timelineOffset = 0;
      setPlaybackDirection(0);
      updateTimelineControls();
      resetOverviewCamera();
    });

    modalCloseBtn.addEventListener("click", closeCardModal);
    cardModalEl.addEventListener("click", (event) => {
      if (event.target?.dataset?.close === "1") closeCardModal();
    });
    const modalPanel = cardModalEl.querySelector(".modal-panel");
    if (modalPanel) {
      modalPanel.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    }
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeCardModal();
    });
  }

  function getCanvasIntersectionId(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // 实际比例下行星真实几何只有亚像素，用户基本不可能精准点到球体本身，
    // 所以把 bodyDisplayMarkers（恒定屏幕大小发光点）也纳入拾取目标，等效于 Celestia 的 "click on marker = click on body"。
    const markerTargets =
      state.viewMode === "realistic" ? Object.values(bodyDisplayMarkers).filter((m) => m.visible) : [];
    const intersects = raycaster.intersectObjects(
      [...Object.values(state.meshes), ...Object.values(planetMeshes), ...markerTargets],
      true
    );
    if (!intersects.length) return null;
    let hit = intersects[0].object;
    while (hit && !hit.userData?.id) {
      hit = hit.parent;
    }
    return hit?.userData?.id || null;
  }

  function onCanvasClick(event) {
    const id = getCanvasIntersectionId(event);
    if (!id) return;
    selectById(id, { focus: false });
  }
  canvas.addEventListener("click", onCanvasClick);

  function onCanvasDoubleClick(event) {
    const id = getCanvasIntersectionId(event);
    if (!id) return;
    selectById(id, { focus: true });
    setStatusBar(`已聚焦 ${getItemById(id)?.name || "当前对象"}。`, "ok");
  }
  canvas.addEventListener("dblclick", onCanvasDoubleClick);

  function updateSceneLabels() {
    if (!sceneLabelLayerEl) return;
    const rect = canvas.getBoundingClientRect();
    const persistentIds = new Set([
      "planet-mercury",
      "planet-venus",
      "planet-earth",
      "planet-mars",
      "planet-jupiter",
      "planet-saturn",
      "planet-uranus",
      "planet-neptune",
    ]);
    // 实际比例下相机普遍在几百单位之外，固定的 cameraDistance<28 阈值会把标签全部藏起来，这里改用自适应阈值。
    const proximityLabelThreshold = state.viewMode === "realistic" ? 1.5 : 42;
    sceneBodyLabels.forEach((labelEl, id) => {
      const mesh = planetMeshes[id];
      if (!mesh) {
        labelEl.style.opacity = "0";
        return;
      }
      const projected = getObjectWorldPosition(mesh, tempVecA).project(camera);
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      const cameraDistance = camera.position.distanceTo(getObjectWorldPosition(mesh, tempVecB));
      const isSelected = state.selected?.id === id;
      const shouldShow =
        projected.z > -1 &&
        projected.z < 1 &&
        x >= -48 &&
        x <= rect.width + 48 &&
        y >= -24 &&
        y <= rect.height + 24 &&
        (isSelected || persistentIds.has(id) || cameraDistance < proximityLabelThreshold);
      labelEl.classList.toggle("is-selected", isSelected);
      labelEl.style.left = `${x}px`;
      labelEl.style.top = `${Math.max(24, y - 14)}px`;
      const nearThreshold = proximityLabelThreshold * 0.9;
      labelEl.style.opacity = shouldShow ? (isSelected ? "1" : cameraDistance < nearThreshold ? "0.92" : "0.72") : "0";
    });
  }

  function updateSceneObjectLabel(target) {
    if (!sceneObjectLabelEl || !target || !state.selected?.name) {
      if (sceneObjectLabelEl) sceneObjectLabelEl.hidden = true;
      return;
    }
    const projected = getObjectWorldPosition(target, tempVecA).project(camera);
    const rect = canvas.getBoundingClientRect();
    const x = (projected.x * 0.5 + 0.5) * rect.width;
    const y = (-projected.y * 0.5 + 0.5) * rect.height;
    const visible = projected.z < 1 && x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
    if (!visible) {
      sceneObjectLabelEl.hidden = true;
      return;
    }
    sceneObjectLabelEl.textContent = target.userData.sceneLabel || state.selected.name;
    sceneObjectLabelEl.style.left = `${x}px`;
    sceneObjectLabelEl.style.top = `${Math.max(54, y - 26)}px`;
    sceneObjectLabelEl.hidden = false;
  }

  function updateSelectionCursor(target) {
    if (!selectionCursorEl || !target || !state.selected?.id) {
      if (selectionCursorEl) selectionCursorEl.hidden = true;
      return;
    }
    const worldPosition = getObjectWorldPosition(target, tempVecA);
    const projected = worldPosition.clone().project(camera);
    const rect = canvas.getBoundingClientRect();
    const x = (projected.x * 0.5 + 0.5) * rect.width;
    const y = (-projected.y * 0.5 + 0.5) * rect.height;
    const visible = projected.z < 1 && x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
    if (!visible) {
      selectionCursorEl.hidden = true;
      return;
    }
    const distance = Math.max(camera.position.distanceTo(worldPosition), 0.0001);
    const pixelsPerUnit = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance);
    const selectionDiameterPx = (target.userData.visualRadius || 1) * pixelsPerUnit * 2;
    const cursorRadius = THREE.MathUtils.clamp(selectionDiameterPx * 0.56 + 18, 22, 92);
    const arrowWidth = THREE.MathUtils.clamp(cursorRadius * 0.42, 14, 28);
    const arrowHeight = THREE.MathUtils.clamp(cursorRadius * 0.26, 10, 18);
    selectionCursorEl.style.setProperty("--cursor-x", `${x}px`);
    selectionCursorEl.style.setProperty("--cursor-y", `${y}px`);
    selectionCursorEl.style.setProperty("--cursor-radius", `${cursorRadius}px`);
    selectionCursorEl.style.setProperty("--cursor-arrow-width", `${arrowWidth}px`);
    selectionCursorEl.style.setProperty("--cursor-arrow-height", `${arrowHeight}px`);
    selectionCursorEl.hidden = false;
  }

  function updateOrbitTooltip(event) {
    if (!state.selectedOrbitId) {
      orbitTooltipEl.hidden = true;
      return;
    }
    const selectedLine = state.orbitLines[state.selectedOrbitId];
    if (!selectedLine) {
      orbitTooltipEl.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const tickHits = raycaster.intersectObjects(state.orbitTickMeshes, false);
    if (tickHits.length) {
      orbitTooltipEl.textContent = `轨迹刻度：${tickHits[0].object.userData.timeLabel}`;
      orbitTooltipEl.style.left = `${Math.min(rect.width - 220, Math.max(12, event.clientX - rect.left + 10))}px`;
      orbitTooltipEl.style.top = `${Math.max(12, event.clientY - rect.top - 28)}px`;
      orbitTooltipEl.hidden = false;
      return;
    }

    const intersects = raycaster.intersectObject(selectedLine, false);
    if (!intersects.length) {
      orbitTooltipEl.hidden = true;
      return;
    }
    const hit = intersects[0];
    const lineData = selectedLine.userData || {};
    const pointCount = Number(lineData.pointCount || 180);
    const idx = Number(hit.index || 0);
    const progress = pointCount > 1 ? idx / (pointCount - 1) : 0;
    const days = Number(lineData.periodDays || 90) * progress;
    const time = new Date(lineData.startDate || new Date());
    time.setUTCDate(time.getUTCDate() + Math.round(days));
    orbitTooltipEl.textContent = `轨迹点时间：${formatDateTime(time)}`;
    orbitTooltipEl.style.left = `${Math.min(rect.width - 220, Math.max(12, event.clientX - rect.left + 10))}px`;
    orbitTooltipEl.style.top = `${Math.max(12, event.clientY - rect.top - 28)}px`;
    orbitTooltipEl.hidden = false;
  }
  canvas.addEventListener("pointermove", updateOrbitTooltip);
  canvas.addEventListener("pointerleave", () => {
    orbitTooltipEl.hidden = true;
  });

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  let lastAnimationTime = 0;

  function animate() {
    resize();
    const t = performance.now() * 0.001;
    const deltaTime = lastAnimationTime ? Math.min(0.1, t - lastAnimationTime) : 0;
    lastAnimationTime = t;
    if (state.playbackDirection !== 0) {
      state.timelineOffset += deltaTime * state.playbackDirection * PLAYBACK_SPEED_STEPS[state.playbackSpeedIndex];
      updateTimelineControls();
    }
    deepSpaceSphere.rotation.y += 0.00003;
    starfield.rotation.y += 0.00012;
    kuiperField.rotation.y -= 0.00028;
    kuiperField.rotation.z = Math.sin(t * 0.12) * 0.018;
    oortCloud.rotation.y += 0.00004;
    nebulaSprites.forEach((sprite, idx) => {
      sprite.material.opacity = 0.08 + idx * 0.02 + Math.sin(t * (0.08 + idx * 0.03)) * 0.015;
    });
    sun.rotation.y += 0.0016;
    const isRealScale = state.viewMode === "realistic";
    const sunBaseScale = isRealScale ? REAL_SCALE.sunRadius / SCHEMATIC_SUN_RADIUS : 1;
    const solarPulse = 1 + Math.sin(t * 1.2) * 0.024;
    sun.scale.setScalar(sunBaseScale * solarPulse);
    sunHalo.position.copy(sun.position);
    sunHalo.material.opacity = 0.66 + Math.sin(t * 1.1) * 0.06;
    // 实际比例下 halo = 太阳真实半径 × REAL_SCALE.sunHaloScale（世界单位），不再与 sunBaseScale 相乘，
    // 否则最终 sprite 宽度会缩到比太阳本体还小，用户会看到「太阳没有光芒」。
    const haloBase = isRealScale ? REAL_SCALE.sunRadius * REAL_SCALE.sunHaloScale : 22;
    sunHalo.scale.setScalar(haloBase + Math.sin(t * 0.9) * haloBase * 0.05);
    sunCorona.position.copy(sun.position);
    sunCorona.material.opacity = 0.22 + Math.sin(t * 0.7) * 0.04;
    const coronaBase = isRealScale ? REAL_SCALE.sunRadius * REAL_SCALE.sunCoronaScale : 37;
    sunCorona.scale.setScalar(coronaBase + Math.sin(t * 0.55) * coronaBase * 0.06);

    staticBodies.forEach((body) => {
      const angle = getOrbitAngle(body.userData.periodDays, body.userData.phaseDays + body.userData.initialPhaseDays);
      computeOrbitalPosition(
        body.userData.orbitRadius,
        angle,
        body.userData.inclinationDeg,
        body.userData.ascendingNodeDeg,
        tempVecA,
        body.userData.eccentricity || 0,
        body.userData.argumentOfPeriapsisDeg || 0
      );
      if (body.userData.orbitCenterId) {
        tempVecA.add(getObjectWorldPosition(getSceneMeshById(body.userData.orbitCenterId), tempVecB));
      }
      body.position.copy(tempVecA);
      body.userData.currentAngle = angle;
      body.rotation.y += body.userData.selfSpin || 0;
      if (body.userData.cloudLayer) {
        body.userData.cloudLayer.rotation.y += body.userData.cloudSpin || 0.0012;
      }
      if (body.userData.halo) {
        body.userData.halo.material.opacity =
          (body.userData.group === "moon" ? 0.045 : 0.08) + Math.sin(t * 1.1 + body.userData.orbitRadius * 0.1) * 0.02;
      }
    });
    // 真实比例下 Sprite marker 想保持 ~18 像素屏幕大小，需要根据视口高度 / fov / 相机距离动态换算一次。
    // pixelsPerUnit = viewportH / (2 * tan(fov/2) * distance) => worldUnitsForPx = px / pixelsPerUnit
    const viewportH = Math.max(1, canvas.clientHeight || renderer.domElement.height || 900);
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const tanHalfFov = Math.tan(fovRad / 2);
    const markerPxForNormal = 16;
    const markerPxForSelected = 24;
    const markerPxForHovered = 20;

    // Celestia 风格 body display marker：实际比例下每个天体/太阳都挂一个恒定屏幕大小的发光点，
    // 用来在远视角下以「差异化的像素分级」传达真实尺度（Sun 64px ≫ Jupiter 18px ≫ Earth 7px ≫ Mercury 4.5px）。
    // 当相机靠近、真实几何已经足够大时，marker 自动淡出交给真实 mesh 显示。
    if (isRealScale) {
      Object.entries(bodyDisplayMarkers).forEach(([bodyId, marker]) => {
        const bodyMesh = bodyId === "sun-core" ? sun : planetMeshes[bodyId];
        if (!bodyMesh) {
          marker.visible = false;
          return;
        }
        marker.visible = true;
        getObjectWorldPosition(bodyMesh, tempVecA);
        marker.position.copy(tempVecA);
        const dist = Math.max(0.0001, camera.position.distanceTo(tempVecA));
        const worldPerPx = (2 * tanHalfFov * dist) / viewportH;
        const targetPx = marker.userData.targetPx;
        const spriteScale = worldPerPx * targetPx;
        marker.scale.setScalar(spriteScale);
        // 真实几何在屏幕上的近似半径（像素）：visualRadius / worldPerPx。
        // 近视角下几何半径已超过 marker 半径的 80% 时开始淡出，完全覆盖后隐藏。
        const visualRadiusPx = (bodyMesh.userData.visualRadius || 0) / Math.max(worldPerPx, 1e-9);
        const geometryFill = visualRadiusPx / Math.max(targetPx * 0.5, 0.5);
        const fadeOpacity = THREE.MathUtils.clamp(1 - (geometryFill - 0.8) / 1.2, 0, 1);
        const isSelected = state.selected?.id === bodyId;
        marker.material.opacity = fadeOpacity * (isSelected ? 1 : 0.92);
      });
      // 太阳的二级光晕 marker：像素半径 haloPx，半透明，强化太阳远视角下的「巨大发光体」观感。
      const sunMarker = bodyDisplayMarkers["sun-core"];
      if (sunMarker && sunMarker.visible) {
        sunDisplayHaloMarker.visible = true;
        sunDisplayHaloMarker.position.copy(sunMarker.position);
        const haloPx = REAL_BODY_MARKER["sun-core"].haloPx || 140;
        const sunDist = Math.max(0.0001, camera.position.distanceTo(sunMarker.position));
        const sunWorldPerPx = (2 * tanHalfFov * sunDist) / viewportH;
        sunDisplayHaloMarker.scale.setScalar(sunWorldPerPx * haloPx * (1 + Math.sin(t * 0.8) * 0.04));
        sunDisplayHaloMarker.material.opacity = sunMarker.material.opacity * 0.38;
      } else {
        sunDisplayHaloMarker.visible = false;
      }
    }
    Object.values(state.meshes).forEach((mesh) => {
      const angle = getOrbitAngle(mesh.userData.periodDays, mesh.userData.phaseDays);
      const orbitPos = computeOrbitalPosition(
        mesh.userData.radius,
        angle,
        mesh.userData.inclinationDeg,
        mesh.userData.ascendingNodeDeg,
        tempVecA,
        mesh.userData.eccentricity || 0,
        mesh.userData.argumentOfPeriapsisDeg || 0
      );
      mesh.position.copy(orbitPos);
      mesh.userData.currentAngle = angle;
      if (mesh.userData.isMeteorMarker) {
        const dist = Math.max(0.0001, camera.position.distanceTo(orbitPos));
        const isSel = state.selected?.id === mesh.userData.id;
        const isHov = state.hoveredId === mesh.userData.id && !isSel;
        // 命中框的像素大小：随选中/悬停略放大，保证"容易点中"的既有交互手感。
        const hitboxPx = isSel ? markerPxForSelected : isHov ? markerPxForHovered : markerPxForNormal;
        const worldPerPx = (2 * tanHalfFov * dist) / viewportH;
        const hitboxScale = worldPerPx * hitboxPx;
        mesh.scale.setScalar(hitboxScale);
        // 命中框始终不可见（opacity 0），raycaster 仍可命中 sprite 几何。
        if (mesh.material) mesh.material.opacity = 0;
        mesh.userData.visualRadius = hitboxScale * 0.5;

        // 视觉精灵：恒定 9 屏幕像素，中心亮 + 8 邻域 bloom。
        const visualSprite = mesh.userData.visualSprite;
        if (visualSprite) {
          visualSprite.position.copy(orbitPos);
          visualSprite.scale.setScalar(worldPerPx * METEOR_VISUAL_PX);
          if (visualSprite.material) {
            visualSprite.material.opacity = isSel ? 1 : isHov ? 0.98 : 0.9;
            visualSprite.material.color.setHex(
              isSel ? 0xff8a7a : (mesh.userData.markerColor || 0xffffff)
            );
          }
        }
      }
    });
    const selectedMesh = state.selected ? getSceneMeshById(state.selected.id) : null;
    selectedMarker.visible = false;
    selectedBeacon.visible = false;
    selectedAura.visible = false;
    selectedTrail.visible = false;
    velocityArrow.visible = false;
    if (selectedMesh) {
      const target = selectedMesh;
      const targetPosition = getObjectWorldPosition(target, tempVecA);
      updateSceneObjectLabel(target);
      updateSelectionCursor(target);
    } else {
      state.selectedTrail = [];
      updateSceneObjectLabel(null);
      updateSelectionCursor(null);
    }
    if (state.playbackDirection !== 0 && focusedTargetId && !isAutoNavigatingCamera) {
      const focusedMesh = getSceneMeshById(focusedTargetId);
      if (focusedMesh) {
        const focusedPosition = getObjectWorldPosition(focusedMesh, tempVecA);
        desiredControlTarget.copy(focusedPosition);
        desiredCameraPosition.copy(focusedPosition).add(focusedCameraOffset);
        camera.position.lerp(desiredCameraPosition, 0.05);
        controls.target.lerp(desiredControlTarget, 0.1);
      }
    }
    if (isAutoNavigatingCamera) {
      camera.position.lerp(desiredCameraPosition, 0.045);
      controls.target.lerp(desiredControlTarget, 0.08);
      const cameraSettled = camera.position.distanceToSquared(desiredCameraPosition) < 0.01;
      const targetSettled = controls.target.distanceToSquared(desiredControlTarget) < 0.01;
      if (cameraSettled && targetSettled) {
        camera.position.copy(desiredCameraPosition);
        controls.target.copy(desiredControlTarget);
        isAutoNavigatingCamera = false;
      }
    }
    controls.update();
    updateSceneLabels();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  async function boot() {
    loadStoredState();
    bindEvents();
    updateScaleModeButton();
    await refreshForTimeline(0);
    animate();
  }

  boot();
})();
