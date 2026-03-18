const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const zoneNameEl = document.getElementById("zone-name");
const signalStatusEl = document.getElementById("signal-status");
const discoveryStatusEl = document.getElementById("discovery-status");
const levelStatusEl = document.getElementById("level-status");
const messageTitleEl = document.getElementById("message-title");
const messageBodyEl = document.getElementById("message-body");
const hudCarouselEl = document.getElementById("hud-carousel");
const hudViewportEl = document.getElementById("hud-viewport");
const hudTrackEl = document.getElementById("hud-track");
const hudPrevEl = document.getElementById("hud-prev");
const hudNextEl = document.getElementById("hud-next");
const hudDotsEl = document.getElementById("hud-dots");
const thumbZoneEl = document.getElementById("thumb-zone");
const thumbBaseEl = document.getElementById("thumb-base");
const thumbKnobEl = document.getElementById("thumb-knob");
const focusButtonEl = document.getElementById("focus-button");
const roofButtonEl = document.getElementById("roof-button");
const audioButtonEl = document.getElementById("audio-button");

window.addEventListener("error", (event) => {
  if (!messageTitleEl || !messageBodyEl) {
    return;
  }
  messageTitleEl.textContent = "Runtime error.";
  messageBodyEl.textContent = event.message;
});

const TAU = Math.PI * 2;
const TILE_W = 74;
const TILE_H = 37;
const HEIGHT_UNIT = 18;
const WORLD_WIDTH = 30;
const WORLD_HEIGHT = 20;

const keys = new Set();
const discovered = new Set();

let lastTime = 0;
let signalPulse = 0;
let cameraState = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.58,
};

const palette = {
  road: "#141b2d",
  lane: "#2f3858",
  sidewalk: "#2d3548",
  plaza: "#243247",
  promenade: "#23333f",
  lot: "#273044",
  roof: "#20283b",
  roofEdge: "#42536c",
  neonPink: "#ff4da8",
  neonCyan: "#61f5ff",
  neonGold: "#ffd36e",
  neonLime: "#9aff9c",
  windowWarm: "#f8d98a",
  windowCool: "#73d5ff",
};

const player = {
  x: 9.2,
  y: 13.9,
  z: 0,
  radius: 0.18,
  speed: 3.9,
  bob: 0,
  surfaceId: null,
  vx: 0,
  vy: 0,
};

const tiles = [];
const tileMap = new Map();
const buildings = [];
const props = [];
const landmarks = [];
const roofSurfaces = [];
const accessPoints = [];
const npcs = [];
const skyTowers = [];

const audioState = {
  music: null,
  enabled: false,
  primed: false,
  currentVolume: 0,
  targetVolume: 0,
  baseVolume: 0.42,
};

const defaultMessage = {
  title: "Touch down in the rain.",
  body:
    "Two connected Neo Tokyo blocks are open tonight. Walk the boulevard, ride access lifts, cross rooftop bridges, and follow the crowd through the storm.",
};

let activeMessage = { ...defaultMessage };

const inputState = {
  joystickPointerId: null,
  joystickVector: { x: 0, y: 0 },
  movePath: [],
  moveTarget: null,
};

const hudState = {
  index: 0,
  count: 0,
  intervalId: null,
  pointerId: null,
  swipeStartX: 0,
  swipeDeltaX: 0,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgba(hex, alpha) {
  const value = hex.replace("#", "");
  const num = parseInt(value, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function tileKey(x, y) {
  return `${x},${y}`;
}

function isoProject(x, y, z, camera) {
  return {
    x: (x - y) * TILE_W * 0.5 + camera.x,
    y: (x + y) * TILE_H * 0.5 - z * HEIGHT_UNIT + camera.y,
  };
}

function screenToWorld(screenX, screenY, z, camera) {
  const isoX = (screenX - camera.x) / (TILE_W * 0.5);
  const isoY = (screenY - camera.y + z * HEIGHT_UNIT) / (TILE_H * 0.5);
  return {
    x: (isoX + isoY) * 0.5,
    y: (isoY - isoX) * 0.5,
  };
}

function setJoystickVector(x, y) {
  inputState.joystickVector.x = clamp(x, -1, 1);
  inputState.joystickVector.y = clamp(y, -1, 1);

  if (!thumbKnobEl) {
    return;
  }

  const px = inputState.joystickVector.x * 34;
  const py = inputState.joystickVector.y * 34;
  thumbKnobEl.style.transform = `translate3d(${px}px, ${py}px, 0)`;
}

function clearMovePath() {
  inputState.movePath = [];
  inputState.moveTarget = null;
}

function setHudSlide(index) {
  if (!hudTrackEl || hudState.count === 0) {
    return;
  }

  hudState.index = (index + hudState.count) % hudState.count;
  hudTrackEl.style.transform = `translateX(-${hudState.index * 100}%)`;

  const slides = hudTrackEl.children;
  for (let i = 0; i < slides.length; i += 1) {
    slides[i].classList.toggle("is-active", i === hudState.index);
  }

  if (!hudDotsEl) {
    return;
  }
  const dots = hudDotsEl.children;
  for (let i = 0; i < dots.length; i += 1) {
    dots[i].classList.toggle("is-active", i === hudState.index);
  }
}

function restartHudAutoplay() {
  if (hudState.intervalId) {
    window.clearInterval(hudState.intervalId);
  }
  if (hudState.count <= 1) {
    return;
  }
  hudState.intervalId = window.setInterval(() => {
    setHudSlide(hudState.index + 1);
  }, 4200);
}

function bindHudCarousel() {
  if (!hudCarouselEl || !hudTrackEl || !hudDotsEl) {
    return;
  }

  hudState.count = hudTrackEl.children.length;
  hudDotsEl.innerHTML = "";

  for (let i = 0; i < hudState.count; i += 1) {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hud-dot";
    dot.setAttribute("aria-label", `Go to hint ${i + 1}`);
    dot.addEventListener("click", () => {
      setHudSlide(i);
      restartHudAutoplay();
    });
    hudDotsEl.appendChild(dot);
  }

  if (hudPrevEl) {
    hudPrevEl.addEventListener("click", () => {
      setHudSlide(hudState.index - 1);
      restartHudAutoplay();
    });
  }

  if (hudNextEl) {
    hudNextEl.addEventListener("click", () => {
      setHudSlide(hudState.index + 1);
      restartHudAutoplay();
    });
  }

  if (hudViewportEl) {
    hudViewportEl.addEventListener("pointerdown", (event) => {
      hudState.pointerId = event.pointerId;
      hudState.swipeStartX = event.clientX;
      hudState.swipeDeltaX = 0;
      hudViewportEl.setPointerCapture(event.pointerId);
    });

    hudViewportEl.addEventListener("pointermove", (event) => {
      if (hudState.pointerId !== event.pointerId) {
        return;
      }
      hudState.swipeDeltaX = event.clientX - hudState.swipeStartX;
    });

    const finishSwipe = (event) => {
      if (hudState.pointerId !== event.pointerId) {
        return;
      }
      const threshold = 42;
      if (hudState.swipeDeltaX > threshold) {
        setHudSlide(hudState.index - 1);
      } else if (hudState.swipeDeltaX < -threshold) {
        setHudSlide(hudState.index + 1);
      }
      hudState.pointerId = null;
      hudState.swipeDeltaX = 0;
      restartHudAutoplay();
    };

    hudViewportEl.addEventListener("pointerup", finishSwipe);
    hudViewportEl.addEventListener("pointercancel", finishSwipe);
  }

  setHudSlide(0);
  restartHudAutoplay();
}

function setMessage(title, body) {
  activeMessage = { title, body };
  messageTitleEl.textContent = title;
  messageBodyEl.textContent = body;
}

function createTile(x, y, type = "lot") {
  return {
    x,
    y,
    z: 0,
    type,
    walkable: true,
    solid: false,
    surfaceId: null,
  };
}

function getTile(x, y) {
  return tileMap.get(tileKey(x, y));
}

function setTile(x, y, patch) {
  const key = tileKey(x, y);
  let tile = tileMap.get(key);
  if (!tile) {
    tile = createTile(x, y);
    tileMap.set(key, tile);
    tiles.push(tile);
  }
  Object.assign(tile, patch);
  return tile;
}

function paintRect(x, y, w, h, patch) {
  for (let iy = y; iy < y + h; iy += 1) {
    for (let ix = x; ix < x + w; ix += 1) {
      setTile(ix, iy, patch);
    }
  }
}

function addBuilding(config) {
  const building = {
    roofDetails: [],
    signs: [],
    windows: "grid",
    roofInset: 0.15,
    roofWalkable: false,
    ...config,
  };
  buildings.push(building);

  for (let y = building.y; y < building.y + building.h; y += 1) {
    for (let x = building.x; x < building.x + building.w; x += 1) {
      setTile(x, y, {
        type: "lot",
        walkable: false,
        solid: true,
        structureId: building.id,
      });
    }
  }

  if (building.roofWalkable) {
    roofSurfaces.push({
      id: `${building.id}-roof`,
      label: building.label,
      x: building.x + building.roofInset,
      y: building.y + building.roofInset,
      w: building.w - building.roofInset * 2,
      h: building.h - building.roofInset * 2,
      z: building.height,
      kind: "roof",
    });
  }
}

function addRoofBridge(config) {
  roofSurfaces.push({
    kind: "bridge",
    ...config,
  });
}

function addAccessPoint(config) {
  accessPoints.push(config);
  props.push({
    kind: "access",
    x: config.x,
    y: config.y,
    z: 0,
    color: config.color || palette.neonCyan,
  });
}

function addLandmark(config) {
  landmarks.push({
    discovered: false,
    level: 0,
    ...config,
  });
}

function addNpc(config) {
  npcs.push({
    routeIndex: 0,
    routeDirection: 1,
    pause: 0,
    bob: Math.random() * TAU,
    speed: 1.15 + Math.random() * 0.6,
    color: config.color || palette.neonGold,
    ...config,
  });
}

function populateSkyline() {
  for (let i = 0; i < 32; i += 1) {
    skyTowers.push({
      x: (i - 10) * 110 + (i % 3) * 28,
      width: 44 + (i % 5) * 18,
      height: 100 + (i % 8) * 30 + Math.random() * 35,
      glow:
        i % 3 === 0
          ? palette.neonCyan
          : i % 3 === 1
            ? palette.neonPink
            : palette.neonGold,
      depth: 0.18 + (i % 7) * 0.08,
    });
  }
}

function initializeBaseTiles() {
  for (let y = 0; y < WORLD_HEIGHT; y += 1) {
    for (let x = 0; x < WORLD_WIDTH; x += 1) {
      setTile(x, y, createTile(x, y, "lot"));
    }
  }

  paintRect(0, 0, WORLD_WIDTH, 1, { type: "road" });
  paintRect(0, WORLD_HEIGHT - 1, WORLD_WIDTH, 1, { type: "road" });
  paintRect(0, 0, 1, WORLD_HEIGHT, { type: "road" });
  paintRect(WORLD_WIDTH - 1, 0, 1, WORLD_HEIGHT, { type: "road" });

  paintRect(13, 0, 4, WORLD_HEIGHT, { type: "road" });
  paintRect(0, 8, WORLD_WIDTH, 4, { type: "road" });

  paintRect(12, 0, 1, WORLD_HEIGHT, { type: "sidewalk" });
  paintRect(17, 0, 1, WORLD_HEIGHT, { type: "sidewalk" });
  paintRect(0, 7, WORLD_WIDTH, 1, { type: "sidewalk" });
  paintRect(0, 12, WORLD_WIDTH, 1, { type: "sidewalk" });
  paintRect(1, 1, WORLD_WIDTH - 2, 1, { type: "sidewalk" });
  paintRect(1, WORLD_HEIGHT - 2, WORLD_WIDTH - 2, 1, { type: "sidewalk" });
  paintRect(1, 1, 1, WORLD_HEIGHT - 2, { type: "sidewalk" });
  paintRect(WORLD_WIDTH - 2, 1, 1, WORLD_HEIGHT - 2, { type: "sidewalk" });

  paintRect(8, 5, 4, 2, { type: "plaza" });
  paintRect(19, 13, 4, 2, { type: "plaza" });
  paintRect(5, 13, 6, 2, { type: "promenade" });
  paintRect(20, 5, 6, 2, { type: "promenade" });
}

function setupWorld() {
  initializeBaseTiles();

  addBuilding({
    id: "kitsune-tower",
    label: "Kitsune Tower",
    x: 2,
    y: 2,
    w: 4,
    h: 4,
    height: 7,
    roofWalkable: false,
    palette: ["#4f3152", "#24142a", "#7f4b7d"],
    windows: "dense",
    signs: [
      { side: "east", level: 3, color: palette.neonPink, text: "KITSUNE" },
      { side: "south", level: 2, color: palette.neonCyan, text: "HOTEL" },
    ],
    roofDetails: [
      { dx: 0.8, dy: 0.8, kind: "water" },
      { dx: 2.8, dy: 1.2, kind: "antenna" },
      { dx: 1.8, dy: 2.8, kind: "ac" },
    ],
  });

  addBuilding({
    id: "capsule-row",
    label: "Capsule Row",
    x: 7,
    y: 2,
    w: 4,
    h: 3,
    height: 3,
    roofWalkable: true,
    roofInset: 0.08,
    palette: ["#39424d", "#161d26", "#546271"],
    windows: "capsule",
    signs: [{ side: "south", level: 1, color: palette.neonLime, text: "SLEEP" }],
    roofDetails: [{ dx: 1.7, dy: 0.9, kind: "garden" }],
  });

  addBuilding({
    id: "market-loft",
    label: "Lantern Market Roof",
    x: 2,
    y: 13,
    w: 5,
    h: 4,
    height: 5,
    roofWalkable: true,
    roofInset: 0.08,
    palette: ["#5c4228", "#28190f", "#9a6a3e"],
    windows: "sparse",
    signs: [
      { side: "east", level: 2, color: palette.neonGold, text: "RAMEN" },
      { side: "north", level: 1, color: palette.neonPink, text: "OPEN" },
    ],
    roofDetails: [
      { dx: 1.3, dy: 1.6, kind: "water" },
      { dx: 3.7, dy: 2.3, kind: "ac" },
    ],
  });

  addBuilding({
    id: "tea-bar",
    label: "Tea Bar Roof",
    x: 8,
    y: 14,
    w: 3,
    h: 2,
    height: 5,
    roofWalkable: true,
    roofInset: 0.08,
    palette: ["#38402a", "#14190f", "#5d6c43"],
    windows: "sparse",
    signs: [{ side: "north", level: 1, color: palette.neonGold, text: "CHA" }],
    roofDetails: [{ dx: 1.5, dy: 0.8, kind: "garden" }],
  });

  addBuilding({
    id: "data-hub",
    label: "Shinra Data Hub Roof",
    x: 19,
    y: 2,
    w: 5,
    h: 5,
    height: 8,
    roofWalkable: true,
    roofInset: 0.1,
    palette: ["#25455b", "#112331", "#3c7da7"],
    windows: "bands",
    signs: [
      { side: "west", level: 4, color: palette.neonCyan, text: "DATA" },
      { side: "south", level: 2, color: palette.neonGold, text: "NODE" },
    ],
    roofDetails: [
      { dx: 1.1, dy: 1.1, kind: "satellite" },
      { dx: 3.2, dy: 3.8, kind: "garden" },
      { dx: 0.7, dy: 4.2, kind: "antenna" },
    ],
  });

  addBuilding({
    id: "sky-clinic",
    label: "Sky Clinic",
    x: 24,
    y: 3,
    w: 3,
    h: 3,
    height: 4,
    roofWalkable: false,
    palette: ["#4c5a6d", "#1e2532", "#75869f"],
    windows: "bands",
    signs: [{ side: "south", level: 1.5, color: palette.neonCyan, text: "CLINIC" }],
    roofDetails: [{ dx: 1.1, dy: 1.3, kind: "satellite" }],
  });

  addBuilding({
    id: "arcade",
    label: "Hikari Arcade Roof",
    x: 18,
    y: 13,
    w: 4,
    h: 4,
    height: 5,
    roofWalkable: true,
    roofInset: 0.08,
    palette: ["#3f365f", "#191427", "#7d67be"],
    windows: "dense",
    signs: [
      { side: "west", level: 2, color: palette.neonPink, text: "ARCADE" },
      { side: "north", level: 1, color: palette.neonCyan, text: "PLAY" },
    ],
    roofDetails: [
      { dx: 1.7, dy: 1.2, kind: "satellite" },
      { dx: 2.6, dy: 1.1, kind: "ac" },
    ],
  });

  addBuilding({
    id: "mono-bar",
    label: "Monorail Bar Roof",
    x: 23,
    y: 13,
    w: 4,
    h: 3,
    height: 5,
    roofWalkable: true,
    roofInset: 0.08,
    palette: ["#34485a", "#141e29", "#567ea2"],
    windows: "dense",
    signs: [
      { side: "west", level: 2, color: palette.neonGold, text: "MONO" },
      { side: "north", level: 1, color: palette.neonPink, text: "BAR" },
    ],
    roofDetails: [
      { dx: 1.5, dy: 0.9, kind: "garden" },
      { dx: 3.0, dy: 1.6, kind: "antenna" },
    ],
  });

  addRoofBridge({
    id: "market-catwalk",
    label: "Lantern Catwalk",
    x: 6.65,
    y: 14.45,
    w: 1.72,
    h: 1.02,
    z: 5,
  });

  addRoofBridge({
    id: "arcade-bridge",
    label: "Arcade Skybridge",
    x: 21.7,
    y: 14.18,
    w: 1.5,
    h: 1.08,
    z: 5,
  });

  const lampPositions = [
    [1.3, 4.0], [1.2, 9.0], [1.1, 14.0], [4.0, 1.2], [9.0, 1.1], [20.0, 1.1],
    [28.0, 4.0], [28.1, 10.0], [28.1, 15.0], [4.0, 18.0], [9.0, 18.1], [20.0, 18.1],
    [15.0, 3.0], [15.0, 6.2], [15.0, 13.8], [15.0, 17.0], [7.0, 10.0], [22.0, 10.0],
  ];
  for (const [x, y] of lampPositions) {
    props.push({ kind: "lamp", x, y, z: 0 });
  }

  const vendingPositions = [
    [6.4, 12.6], [10.6, 5.7], [17.8, 14.2], [24.4, 11.7], [23.6, 6.6],
  ];
  for (const [x, y] of vendingPositions) {
    props.push({ kind: "vending", x, y, z: 0 });
  }

  const steamPositions = [
    [5.4, 9.6], [10.6, 12.6], [18.2, 8.0], [22.7, 12.2], [25.5, 8.8],
  ];
  for (const [x, y] of steamPositions) {
    props.push({ kind: "steam", x, y, z: 0 });
  }

  const sakuraPositions = [
    [8.6, 6.2], [10.8, 6.2], [19.2, 14.8], [22.0, 14.8], [8.0, 13.2], [21.6, 5.2],
  ];
  for (const [x, y] of sakuraPositions) {
    props.push({ kind: "tree", x, y, z: 0 });
  }

  props.push({ kind: "gate", x: 9.5, y: 7.6, z: 0 });
  props.push({ kind: "gate", x: 21.5, y: 12.4, z: 0 });
  props.push({ kind: "billboard", x: 6.2, y: 2.1, z: 0.4 });
  props.push({ kind: "billboard", x: 23.8, y: 16.6, z: 0.4 });

  addAccessPoint({
    id: "capsule-stairs",
    x: 11.2,
    y: 4.6,
    targetX: 10.3,
    targetY: 4.2,
    targetSurfaceId: "capsule-row-roof",
    color: palette.neonLime,
    label: "Capsule stair",
  });
  addAccessPoint({
    id: "market-lift",
    x: 7.2,
    y: 15.6,
    targetX: 6.4,
    targetY: 15.4,
    targetSurfaceId: "market-loft-roof",
    color: palette.neonGold,
    label: "Market lift",
  });
  addAccessPoint({
    id: "data-lift",
    x: 18.4,
    y: 6.8,
    targetX: 19.8,
    targetY: 6.2,
    targetSurfaceId: "data-hub-roof",
    color: palette.neonCyan,
    label: "Data hub lift",
  });
  addAccessPoint({
    id: "arcade-fire-escape",
    x: 22.2,
    y: 16.3,
    targetX: 21.4,
    targetY: 15.9,
    targetSurfaceId: "arcade-roof",
    color: palette.neonPink,
    label: "Arcade fire escape",
  });

  addLandmark({
    id: "ramen",
    title: "Lantern Ramen",
    body:
      "A broth stall glows under paper lanterns while rain hisses on the griddle. Steam curls into the market awning like stage fog.",
    x: 4.7,
    y: 13.2,
    radius: 1.3,
    zone: "Lantern Market",
  });
  addLandmark({
    id: "capsules",
    title: "Capsule Alley",
    body:
      "Compact sleep pods blink with soft green status lights. It feels improvised and permanent at the same time.",
    x: 10.8,
    y: 4.8,
    radius: 1.15,
    zone: "Capsule Alley",
  });
  addLandmark({
    id: "crossroads",
    title: "Boulevard Crossing",
    body:
      "The rain-slick intersection pulls both blocks together: commuter drones above, monorail echoes below, neon smearing across every puddle.",
    x: 15.0,
    y: 10.0,
    radius: 1.6,
    zone: "Signal Crossing",
  });
  addLandmark({
    id: "data-hub",
    title: "Shinra Data Hub",
    body:
      "A cyan spine of servers hums behind smoked glass. The rooftop relay dishes make the whole tower feel like a listening device.",
    x: 20.4,
    y: 6.2,
    radius: 1.35,
    zone: "North Data Walk",
  });
  addLandmark({
    id: "arcade",
    title: "Hikari Arcade",
    body:
      "Bass leaks through the shutters with a magenta wash. Cabinets inside flicker between rhythm battles and mech duels.",
    x: 19.7,
    y: 15.0,
    radius: 1.4,
    zone: "Arcade Row",
  });
  addLandmark({
    id: "market-roof",
    title: "Lantern Catwalk",
    body:
      "Up here the market breathes differently. Vent fans, rooftop herb boxes, and warm lantern light turn the roof into a hidden street.",
    x: 6.9,
    y: 15.1,
    radius: 1.4,
    level: 5,
    zone: "Lantern Roofs",
  });
  addLandmark({
    id: "skybridge",
    title: "Arcade Skybridge",
    body:
      "A narrow bridge links the arcade roof to the monorail bar. Below it, traffic glows like a live circuit board.",
    x: 22.4,
    y: 14.7,
    radius: 1.2,
    level: 5,
    zone: "Skybridge Walk",
  });
  addLandmark({
    id: "data-roof",
    title: "Relay Garden",
    body:
      "The data hub roof mixes antenna masts with a tiny hydroponic patch. It is the quietest place in the district, somehow.",
    x: 22.0,
    y: 5.3,
    radius: 1.4,
    level: 8,
    zone: "Relay Roof",
  });

  addNpc({
    name: "Courier",
    x: 4.0,
    y: 10.0,
    route: [
      [4.0, 10.0],
      [10.5, 10.0],
      [10.5, 13.6],
      [5.2, 13.6],
    ],
    color: palette.neonCyan,
  });
  addNpc({
    name: "Drifter",
    x: 20.2,
    y: 9.3,
    route: [
      [20.2, 9.3],
      [25.8, 9.3],
      [25.8, 14.2],
      [19.0, 14.2],
    ],
    color: palette.neonPink,
  });
  addNpc({
    name: "Vendor",
    x: 8.8,
    y: 6.4,
    route: [
      [8.8, 6.4],
      [11.6, 6.4],
      [11.6, 9.5],
      [8.8, 9.5],
    ],
    color: palette.neonGold,
  });
  addNpc({
    name: "Scout",
    x: 15.0,
    y: 4.2,
    route: [
      [15.0, 4.2],
      [15.0, 16.0],
      [17.4, 16.0],
      [17.4, 4.2],
    ],
    color: palette.neonLime,
  });

  populateSkyline();
}

function getRoofSurfaceById(id) {
  return roofSurfaces.find((surface) => surface.id === id) || null;
}

function getSurfaceAt(x, y, z) {
  return roofSurfaces.find((surface) =>
    Math.abs(surface.z - z) < 0.1 &&
    x >= surface.x &&
    x <= surface.x + surface.w &&
    y >= surface.y &&
    y <= surface.y + surface.h
  ) || null;
}

function getCurrentZoneName() {
  if (player.z > 0.1) {
    const roofLandmark = landmarks.find((landmark) =>
      landmark.level === player.z &&
      Math.hypot(player.x - landmark.x, player.y - landmark.y) < landmark.radius + 1
    );
    if (roofLandmark) {
      return roofLandmark.zone;
    }
    return "Rooftop Walk";
  }

  if (player.x < 13) {
    if (player.y < 8) {
      return "North Lantern Ward";
    }
    if (player.y > 12) {
      return "Lantern Market";
    }
    return "West Crosswalk";
  }

  if (player.x > 17) {
    if (player.y < 8) {
      return "North Data Walk";
    }
    if (player.y > 12) {
      return "Arcade Row";
    }
    return "East Promenade";
  }

  return "Signal Crossing";
}

function isPointWalkableGround(x, y) {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const tile = getTile(tileX, tileY);
  return Boolean(tile && tile.walkable && !tile.solid);
}

function isTileWalkableAtLevel(tileX, tileY, z) {
  if (tileX < 0 || tileY < 0 || tileX >= WORLD_WIDTH || tileY >= WORLD_HEIGHT) {
    return false;
  }

  if (z > 0.1) {
    const samplePoints = [
      [tileX + 0.5, tileY + 0.5],
      [tileX + 0.25, tileY + 0.5],
      [tileX + 0.75, tileY + 0.5],
      [tileX + 0.5, tileY + 0.25],
      [tileX + 0.5, tileY + 0.75],
    ];
    return samplePoints.some(([x, y]) => Boolean(getSurfaceAt(x, y, z)));
  }

  return isPointWalkableGround(tileX + 0.5, tileY + 0.5);
}

function canOccupy(nx, ny, nz) {
  const sampleRadius = player.radius * 0.85;
  const offsets = [
    [0, 0],
    [sampleRadius, 0],
    [-sampleRadius, 0],
    [0, sampleRadius],
    [0, -sampleRadius],
    [sampleRadius * 0.7, sampleRadius * 0.7],
    [sampleRadius * 0.7, -sampleRadius * 0.7],
    [-sampleRadius * 0.7, sampleRadius * 0.7],
    [-sampleRadius * 0.7, -sampleRadius * 0.7],
  ];

  if (nz > 0.1) {
    return offsets.every(([ox, oy]) => Boolean(getSurfaceAt(nx + ox, ny + oy, nz)));
  }

  return offsets.every(([ox, oy]) => isPointWalkableGround(nx + ox, ny + oy));
}

function findNearestWalkableTile(tileX, tileY, z, maxRadius = 4) {
  if (isTileWalkableAtLevel(tileX, tileY, z)) {
    return { x: tileX, y: tileY };
  }

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let y = tileY - radius; y <= tileY + radius; y += 1) {
      for (let x = tileX - radius; x <= tileX + radius; x += 1) {
        if (Math.abs(x - tileX) !== radius && Math.abs(y - tileY) !== radius) {
          continue;
        }
        if (isTileWalkableAtLevel(x, y, z)) {
          return { x, y };
        }
      }
    }
  }

  return null;
}

function buildPath(startX, startY, goalX, goalY, z) {
  const start = findNearestWalkableTile(startX, startY, z, 2);
  const goal = findNearestWalkableTile(goalX, goalY, z, 4);
  if (!start || !goal) {
    return [];
  }

  const startKey = tileKey(start.x, start.y);
  const goalKey = tileKey(goal.x, goal.y);
  const frontier = [{ x: start.x, y: start.y, cost: 0, priority: 0 }];
  const cameFrom = new Map([[startKey, null]]);
  const costSoFar = new Map([[startKey, 0]]);
  const neighbors = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.priority - b.priority);
    const current = frontier.shift();
    const currentKey = tileKey(current.x, current.y);
    if (currentKey === goalKey) {
      break;
    }

    for (const [dx, dy] of neighbors) {
      const nextX = current.x + dx;
      const nextY = current.y + dy;
      if (!isTileWalkableAtLevel(nextX, nextY, z)) {
        continue;
      }

      if (dx !== 0 && dy !== 0) {
        if (!isTileWalkableAtLevel(current.x + dx, current.y, z) || !isTileWalkableAtLevel(current.x, current.y + dy, z)) {
          continue;
        }
      }

      const nextKey = tileKey(nextX, nextY);
      const stepCost = dx !== 0 && dy !== 0 ? 1.414 : 1;
      const newCost = costSoFar.get(currentKey) + stepCost;

      if (!costSoFar.has(nextKey) || newCost < costSoFar.get(nextKey)) {
        costSoFar.set(nextKey, newCost);
        const heuristic = Math.hypot(goal.x - nextX, goal.y - nextY);
        frontier.push({
          x: nextX,
          y: nextY,
          cost: newCost,
          priority: newCost + heuristic,
        });
        cameFrom.set(nextKey, currentKey);
      }
    }
  }

  if (!cameFrom.has(goalKey)) {
    return [];
  }

  const path = [];
  let currentKey = goalKey;
  while (currentKey) {
    const [x, y] = currentKey.split(",").map(Number);
    path.push({ x: x + 0.5, y: y + 0.5 });
    currentKey = cameFrom.get(currentKey);
  }

  path.reverse();
  return path.slice(1);
}

function setMoveDestination(worldX, worldY) {
  const targetTileX = Math.floor(worldX);
  const targetTileY = Math.floor(worldY);
  const startTileX = Math.floor(player.x);
  const startTileY = Math.floor(player.y);
  const path = buildPath(startTileX, startTileY, targetTileX, targetTileY, player.z);
  if (path.length === 0) {
    return;
  }
  inputState.movePath = path;
  inputState.moveTarget = path[path.length - 1];
}

function ensureSafeSpawn() {
  const spawnCandidates = [
    [9.2, 13.9],
    [15.0, 10.0],
    [20.0, 14.6],
    [9.2, 6.5],
  ];

  for (const [x, y] of spawnCandidates) {
    if (canOccupy(x, y, 0)) {
      player.x = x;
      player.y = y;
      player.z = 0;
      player.surfaceId = null;
      return;
    }
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawDiamond(x, y, color, stroke) {
  ctx.beginPath();
  ctx.moveTo(x, y - TILE_H * 0.5);
  ctx.lineTo(x + TILE_W * 0.5, y);
  ctx.lineTo(x, y + TILE_H * 0.5);
  ctx.lineTo(x - TILE_W * 0.5, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawBackground(camera, time) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  const skyGradient = ctx.createLinearGradient(0, 0, 0, height);
  skyGradient.addColorStop(0, "#11254b");
  skyGradient.addColorStop(0.42, "#09162f");
  skyGradient.addColorStop(1, "#02050a");
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createRadialGradient(
    width * 0.52,
    height * 0.18,
    80,
    width * 0.52,
    height * 0.18,
    width * 0.68
  );
  haze.addColorStop(0, "rgba(92, 205, 255, 0.18)");
  haze.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);

  for (const tower of skyTowers) {
    const shift = camera.x * tower.depth * 0.15;
    const x = tower.x + shift + width * 0.42;
    const y = height * 0.18 + tower.depth * 110;
    ctx.fillStyle = rgba("#09111d", 0.9);
    ctx.fillRect(x, y, tower.width, tower.height);
    ctx.fillStyle = rgba(tower.glow, 0.18);
    ctx.fillRect(x - 2, y - 2, tower.width + 4, tower.height + 4);

    for (let row = 8; row < tower.height - 12; row += 10) {
      if (((row + tower.width) / 8) % 2 > 1) {
        continue;
      }
      ctx.fillStyle = rgba(tower.glow, 0.52);
      ctx.fillRect(x + 5, y + row, tower.width - 10, 2);
    }
  }

  for (let i = 0; i < 72; i += 1) {
    const streakX = (i * 83 + time * 110) % (width + 260) - 130;
    const streakY = (i * 47) % height;
    ctx.strokeStyle = "rgba(140, 220, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(streakX, streakY);
    ctx.lineTo(streakX - 18, streakY + 34);
    ctx.stroke();
  }
}

function drawTile(tile, camera, time) {
  const point = isoProject(tile.x + 0.5, tile.y + 0.5, 0, camera);
  let color = palette.lot;
  let edge = "rgba(255,255,255,0.05)";

  if (tile.type === "road") {
    color = palette.road;
    edge = "rgba(120, 140, 180, 0.08)";
  } else if (tile.type === "sidewalk") {
    color = palette.sidewalk;
  } else if (tile.type === "plaza") {
    color = palette.plaza;
    edge = rgba(palette.neonPink, 0.18);
  } else if (tile.type === "promenade") {
    color = palette.promenade;
    edge = rgba(palette.neonCyan, 0.16);
  }

  drawDiamond(point.x, point.y, color, edge);

  if (tile.type === "road" && ((tile.x + tile.y) % 2 === 0)) {
    ctx.strokeStyle = "rgba(250, 240, 180, 0.11)";
    ctx.beginPath();
    ctx.moveTo(point.x - 10, point.y);
    ctx.lineTo(point.x + 10, point.y);
    ctx.stroke();
  }

  if (tile.type === "plaza" || tile.type === "promenade") {
    const pulse = (Math.sin(time * 2.4 + tile.x + tile.y) + 1) * 0.5;
    const glowColor =
      tile.type === "plaza"
        ? rgba(palette.neonPink, 0.07 + pulse * 0.07)
        : rgba(palette.neonCyan, 0.05 + pulse * 0.05);
    drawDiamond(point.x, point.y, glowColor);
  }
}

function drawBuildingWindows(building, camera) {
  const density =
    building.windows === "dense"
      ? 0.82
      : building.windows === "bands"
        ? 0.6
        : building.windows === "capsule"
          ? 0.45
          : 0.3;

  const spacingX = building.windows === "capsule" ? 0.8 : 0.65;
  const spacingZ = building.windows === "bands" ? 1.2 : 0.85;

  for (let localY = 0.35; localY < building.h - 0.15; localY += 0.8) {
    for (let level = 0.9; level < building.height - 0.2; level += spacingZ) {
      const chance = Math.sin(localY * 4.1 + level * 1.7 + building.x) * 0.5 + 0.5;
      if (chance > density) {
        continue;
      }
      const source = isoProject(building.x + 0.04, building.y + localY, level, camera);
      const source2 = isoProject(
        building.x + 0.04,
        building.y + Math.min(localY + 0.28, building.h - 0.1),
        level - 0.18,
        camera
      );
      ctx.fillStyle = chance > density * 0.74 ? palette.windowWarm : palette.windowCool;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(source.x - 3, source.y - 5, 5, 10);
      ctx.fillRect(source2.x - 3, source2.y - 5, 5, 10);
      ctx.globalAlpha = 1;
    }
  }

  for (let localX = 0.35; localX < building.w - 0.15; localX += spacingX) {
    for (let level = 0.9; level < building.height - 0.2; level += spacingZ) {
      const chance = Math.cos(localX * 3.7 + level * 1.9 + building.y) * 0.5 + 0.5;
      if (chance > density) {
        continue;
      }
      const source = isoProject(building.x + localX, building.y + 0.02, level, camera);
      const source2 = isoProject(
        building.x + Math.min(localX + 0.28, building.w - 0.1),
        building.y + 0.02,
        level - 0.18,
        camera
      );
      ctx.fillStyle = chance > density * 0.7 ? palette.windowWarm : palette.windowCool;
      ctx.globalAlpha = 0.74;
      ctx.fillRect(source.x - 2, source.y - 5, 4, 10);
      ctx.fillRect(source2.x - 2, source2.y - 5, 4, 10);
      ctx.globalAlpha = 1;
    }
  }
}

function drawRoofDetails(building, camera) {
  for (const detail of building.roofDetails) {
    const anchor = isoProject(
      building.x + detail.dx,
      building.y + detail.dy,
      building.height + 0.04,
      camera
    );

    if (detail.kind === "water") {
      ctx.fillStyle = "rgba(80, 110, 126, 0.95)";
      ctx.fillRect(anchor.x - 10, anchor.y - 14, 20, 18);
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(anchor.x - 8, anchor.y - 12, 16, 4);
    } else if (detail.kind === "ac") {
      ctx.fillStyle = "rgba(110, 120, 132, 0.95)";
      ctx.fillRect(anchor.x - 9, anchor.y - 7, 18, 10);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.strokeRect(anchor.x - 9, anchor.y - 7, 18, 10);
    } else if (detail.kind === "antenna") {
      ctx.strokeStyle = "rgba(190, 230, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y + 4);
      ctx.lineTo(anchor.x, anchor.y - 28);
      ctx.stroke();
      ctx.fillStyle = palette.neonPink;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y - 28, 3, 0, TAU);
      ctx.fill();
    } else if (detail.kind === "satellite") {
      ctx.strokeStyle = "rgba(210, 220, 235, 0.92)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(anchor.x, anchor.y - 2, 10, 6, -0.4, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(anchor.x + 2, anchor.y);
      ctx.lineTo(anchor.x + 12, anchor.y - 10);
      ctx.stroke();
    } else if (detail.kind === "garden") {
      ctx.fillStyle = "rgba(36, 76, 44, 0.95)";
      ctx.fillRect(anchor.x - 10, anchor.y - 8, 20, 12);
      for (let i = 0; i < 4; i += 1) {
        ctx.fillStyle = i % 2 === 0 ? "#8df995" : "#4ad577";
        ctx.beginPath();
        ctx.arc(anchor.x - 6 + i * 4, anchor.y - 2 - (i % 2) * 2, 3.5, 0, TAU);
        ctx.fill();
      }
    }
  }
}

function drawSigns(building, camera) {
  ctx.font = '10px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
  ctx.textAlign = "center";

  for (const sign of building.signs) {
    const sideX =
      sign.side === "east"
        ? building.x + building.w
        : sign.side === "west"
          ? building.x
          : building.x + building.w * 0.5;
    const sideY =
      sign.side === "south"
        ? building.y + building.h
        : sign.side === "north"
          ? building.y
          : building.y + building.h * 0.5;
    const anchor = isoProject(sideX, sideY, sign.level, camera);
    const width = 14 + sign.text.length * 4.5;
    const height = 20;
    ctx.fillStyle = rgba("#081018", 0.78);
    ctx.fillRect(anchor.x - width * 0.5, anchor.y - height, width, height);
    ctx.strokeStyle = rgba(sign.color, 0.95);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(anchor.x - width * 0.5, anchor.y - height, width, height);
    ctx.shadowColor = sign.color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = sign.color;
    ctx.fillText(sign.text, anchor.x, anchor.y - 6);
    ctx.shadowBlur = 0;
  }
}

function drawRoofRailings(building, camera) {
  if (!building.roofWalkable) {
    return;
  }
  const top = isoProject(building.x, building.y, building.height, camera);
  const topEast = isoProject(building.x + building.w, building.y, building.height, camera);
  const topSouth = isoProject(building.x, building.y + building.h, building.height, camera);
  const topCorner = isoProject(building.x + building.w, building.y + building.h, building.height, camera);

  ctx.strokeStyle = rgba(palette.roofEdge, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(topEast.x, topEast.y);
  ctx.lineTo(topCorner.x, topCorner.y);
  ctx.lineTo(topSouth.x, topSouth.y);
  ctx.closePath();
  ctx.stroke();
}

function drawExtrudedBox(building, camera) {
  const top = isoProject(building.x, building.y, building.height, camera);
  const topEast = isoProject(building.x + building.w, building.y, building.height, camera);
  const topSouth = isoProject(building.x, building.y + building.h, building.height, camera);
  const topCorner = isoProject(
    building.x + building.w,
    building.y + building.h,
    building.height,
    camera
  );
  const base = isoProject(building.x, building.y, 0, camera);
  const baseEast = isoProject(building.x + building.w, building.y, 0, camera);
  const baseSouth = isoProject(building.x, building.y + building.h, 0, camera);

  const [topColor, leftColor, rightColor] = building.palette;

  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(topEast.x, topEast.y);
  ctx.lineTo(topCorner.x, topCorner.y);
  ctx.lineTo(topSouth.x, topSouth.y);
  ctx.closePath();
  const roofGradient = ctx.createLinearGradient(top.x, top.y, topCorner.x, topCorner.y);
  roofGradient.addColorStop(0, rgba(topColor, 0.97));
  roofGradient.addColorStop(1, rgba(rightColor, 0.96));
  ctx.fillStyle = roofGradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(topSouth.x, topSouth.y);
  ctx.lineTo(baseSouth.x, baseSouth.y);
  ctx.lineTo(base.x, base.y);
  ctx.closePath();
  const leftGradient = ctx.createLinearGradient(top.x, top.y, base.x, base.y);
  leftGradient.addColorStop(0, rgba(leftColor, 0.95));
  leftGradient.addColorStop(1, rgba("#0c111a", 0.98));
  ctx.fillStyle = leftGradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(topEast.x, topEast.y);
  ctx.lineTo(baseEast.x, baseEast.y);
  ctx.lineTo(base.x, base.y);
  ctx.closePath();
  const rightGradient = ctx.createLinearGradient(top.x, top.y, baseEast.x, baseEast.y);
  rightGradient.addColorStop(0, rgba(rightColor, 0.93));
  rightGradient.addColorStop(1, rgba("#081018", 0.98));
  ctx.fillStyle = rightGradient;
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();

  drawBuildingWindows(building, camera);
  drawRoofDetails(building, camera);
  drawRoofRailings(building, camera);
  drawSigns(building, camera);
}

function drawRoofBridge(surface, camera, time) {
  const center = isoProject(surface.x + surface.w * 0.5, surface.y + surface.h * 0.5, surface.z, camera);
  const width = TILE_W * surface.w * 0.55;
  const height = TILE_H * surface.h * 0.6;
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(-0.26);
  ctx.fillStyle = "rgba(34, 43, 62, 0.96)";
  ctx.fillRect(-width * 0.5, -height * 0.5, width, height);
  ctx.strokeStyle = rgba(palette.neonCyan, 0.55 + Math.sin(time * 3.2) * 0.08);
  ctx.lineWidth = 2;
  ctx.strokeRect(-width * 0.5, -height * 0.5, width, height);
  ctx.restore();
}

function drawLamp(prop, camera, time) {
  const base = isoProject(prop.x, prop.y, 0, camera);
  ctx.strokeStyle = "rgba(30, 40, 56, 0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - 4);
  ctx.lineTo(base.x, base.y - 34);
  ctx.stroke();

  const glowY = base.y - 38;
  const pulse = 0.8 + Math.sin(time * 4 + prop.x) * 0.2;
  ctx.fillStyle = rgba(palette.neonGold, 0.9);
  ctx.beginPath();
  ctx.arc(base.x, glowY, 4, 0, TAU);
  ctx.fill();

  const glow = ctx.createRadialGradient(base.x, glowY, 0, base.x, glowY, 46);
  glow.addColorStop(0, rgba(palette.neonGold, 0.26 * pulse));
  glow.addColorStop(1, "rgba(255, 211, 110, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - 10, 34, 24, 0, 0, TAU);
  ctx.fill();
}

function drawVending(prop, camera, time) {
  const base = isoProject(prop.x, prop.y, prop.z || 0, camera);
  ctx.fillStyle = "rgba(40, 47, 70, 0.96)";
  ctx.fillRect(base.x - 10, base.y - 28, 20, 30);
  ctx.fillStyle = rgba(palette.neonCyan, 0.18);
  ctx.fillRect(base.x - 8, base.y - 25, 16, 10);
  ctx.fillStyle = rgba(palette.neonPink, 0.75);
  ctx.fillRect(base.x - 7, base.y - 13, 14, 8);
  const glow = ctx.createRadialGradient(base.x, base.y - 18, 2, base.x, base.y - 18, 26);
  glow.addColorStop(0, rgba(palette.neonPink, 0.24 + Math.sin(time * 3 + prop.x) * 0.06));
  glow.addColorStop(1, "rgba(255, 77, 168, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(base.x, base.y - 14, 24, 0, TAU);
  ctx.fill();
}

function drawSteam(prop, camera, time) {
  const base = isoProject(prop.x, prop.y, 0, camera);
  for (let i = 0; i < 5; i += 1) {
    const drift = Math.sin(time * 1.4 + i + prop.x) * 8;
    const rise = (time * 14) % 14;
    ctx.fillStyle = `rgba(200, 235, 255, ${0.1 - i * 0.014})`;
    ctx.beginPath();
    ctx.ellipse(
      base.x + drift,
      base.y - 10 - i * 10 - rise,
      8 + i * 2,
      6 + i * 2,
      0,
      0,
      TAU
    );
    ctx.fill();
  }
}

function drawTree(prop, camera, time) {
  const base = isoProject(prop.x, prop.y, 0, camera);
  ctx.fillStyle = "rgba(60, 34, 28, 0.9)";
  ctx.fillRect(base.x - 2, base.y - 18, 4, 16);
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255, 164, 205, 0.9)" : "rgba(255, 122, 188, 0.88)";
    ctx.beginPath();
    ctx.arc(
      base.x - 10 + i * 5,
      base.y - 23 - Math.sin(time * 2 + i + prop.x) * 1.2,
      7,
      0,
      TAU
    );
    ctx.fill();
  }
}

function drawGate(prop, camera) {
  const base = isoProject(prop.x, prop.y, 0, camera);
  ctx.strokeStyle = "rgba(120, 42, 58, 0.92)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(base.x - 24, base.y - 6);
  ctx.lineTo(base.x - 24, base.y - 34);
  ctx.moveTo(base.x + 24, base.y - 6);
  ctx.lineTo(base.x + 24, base.y - 34);
  ctx.moveTo(base.x - 31, base.y - 34);
  ctx.lineTo(base.x + 31, base.y - 34);
  ctx.stroke();
}

function drawBillboard(prop, camera, time) {
  const base = isoProject(prop.x, prop.y, prop.z || 0.4, camera);
  ctx.strokeStyle = "rgba(30, 38, 54, 0.95)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(base.x, base.y - 42);
  ctx.stroke();
  ctx.fillStyle = "rgba(8, 12, 26, 0.9)";
  ctx.fillRect(base.x - 26, base.y - 70, 52, 24);
  const gradient = ctx.createLinearGradient(base.x - 26, base.y - 70, base.x + 26, base.y - 46);
  gradient.addColorStop(0, rgba(palette.neonPink, 0.75));
  gradient.addColorStop(1, rgba(palette.neonCyan, 0.75));
  ctx.fillStyle = gradient;
  ctx.fillRect(base.x - 23, base.y - 67, 46, 18);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = '9px Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(time % 8 < 4 ? "NEO TOKYO" : "SKYLINE LOOP", base.x, base.y - 55);
}

function drawAccess(prop, camera, time) {
  const base = isoProject(prop.x, prop.y, 0, camera);
  ctx.strokeStyle = rgba(prop.color, 0.9);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - 4);
  ctx.lineTo(base.x, base.y - 28);
  ctx.stroke();
  ctx.shadowColor = prop.color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = rgba(prop.color, 0.85);
  ctx.beginPath();
  ctx.arc(base.x, base.y - 32 - Math.sin(time * 3 + prop.x) * 2, 5, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawCharacter(x, y, z, color, camera, bob, scale = 1) {
  const base = isoProject(x, y, z + Math.sin(bob) * 0.04, camera);
  ctx.fillStyle = rgba(color, 0.16);
  ctx.beginPath();
  ctx.ellipse(base.x, base.y + 7, 12 * scale, 7 * scale, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "rgba(12, 16, 25, 0.95)";
  ctx.beginPath();
  ctx.ellipse(base.x, base.y - 11 * scale, 8 * scale, 13 * scale, 0, 0, TAU);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(base.x, base.y - 23 * scale, 4.5 * scale, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = rgba(color, 0.92);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y - 19 * scale);
  ctx.lineTo(base.x, base.y - 2 * scale);
  ctx.lineTo(base.x - 8 * scale, base.y + 9 * scale);
  ctx.moveTo(base.x, base.y - 2 * scale);
  ctx.lineTo(base.x + 8 * scale, base.y + 9 * scale);
  ctx.moveTo(base.x, base.y - 8 * scale);
  ctx.lineTo(base.x - 8 * scale, base.y - 1 * scale);
  ctx.moveTo(base.x, base.y - 8 * scale);
  ctx.lineTo(base.x + 8 * scale, base.y - 1 * scale);
  ctx.stroke();
}

function drawPlayer(camera, time) {
  drawCharacter(player.x, player.y, player.z, palette.neonCyan, camera, player.bob + time * 6, 1);
}

function drawNpc(npc, camera, time) {
  drawCharacter(npc.x, npc.y, 0, npc.color, camera, npc.bob + time * 4, 0.88);
}

function drawRain(time) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.strokeStyle = "rgba(150, 220, 255, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 180; i += 1) {
    const x = (i * 59 + time * 380) % (width + 200) - 100;
    const y = (i * 71 + time * 700) % (height + 120) - 120;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 10, y + 22);
    ctx.stroke();
  }
}

function drawLandmarkBeacons(camera, time) {
  for (const landmark of landmarks) {
    if (Math.abs(landmark.level - player.z) > 0.1) {
      continue;
    }
    const base = isoProject(landmark.x, landmark.y, landmark.level, camera);
    const near = Math.hypot(player.x - landmark.x, player.y - landmark.y) < landmark.radius;
    const alpha = near ? 0.42 : 0.16;
    ctx.strokeStyle = rgba(near ? palette.neonGold : palette.neonCyan, alpha);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, 18 + Math.sin(time * 3 + landmark.x) * 3, 9, 0, 0, TAU);
    ctx.stroke();
  }
}

function findNearbyAccessPoint() {
  return accessPoints.find((access) => {
    if (player.z < 0.1) {
      return Math.hypot(player.x - access.x, player.y - access.y) < 0.9;
    }

    const surface = getRoofSurfaceById(access.targetSurfaceId);
    return Boolean(
      surface &&
      Math.abs(surface.z - player.z) < 0.1 &&
      Math.hypot(player.x - access.targetX, player.y - access.targetY) < 0.9
    );
  }) || null;
}

function tryToggleAccessPoint() {
  const access = findNearbyAccessPoint();
  if (!access) {
    setMessage(
      "No roof access in range.",
      "Move beside a glowing lift node or fire escape marker, then press R."
    );
    return;
  }

  if (player.z < 0.1) {
    const surface = getRoofSurfaceById(access.targetSurfaceId);
    if (!surface) {
      return;
    }
    player.x = access.targetX;
    player.y = access.targetY;
    player.z = surface.z;
    player.surfaceId = surface.id;
    setMessage(
      `${access.label} engaged.`,
      "You are on the roof now. Use R again at the access marker to head back down."
    );
  } else {
    player.x = access.x;
    player.y = access.y;
    player.z = 0;
    player.surfaceId = null;
    setMessage(
      `${access.label} disengaged.`,
      "Boots back on the street. The district opens up in every direction."
    );
  }
}

function nearbyLandmark() {
  let best = null;
  let bestDistance = Infinity;
  for (const landmark of landmarks) {
    if (Math.abs(landmark.level - player.z) > 0.1) {
      continue;
    }
    const distance = Math.hypot(player.x - landmark.x, player.y - landmark.y);
    if (distance < landmark.radius && distance < bestDistance) {
      best = landmark;
      bestDistance = distance;
    }
  }
  return best;
}

function pulseNearbyLandmark() {
  const landmark = nearbyLandmark();
  if (!landmark || landmark.discovered) {
    return;
  }
  landmark.discovered = true;
  discovered.add(landmark.id);
  setMessage(landmark.title, landmark.body);
}

function focusLandmark() {
  const landmark = nearbyLandmark();
  if (!landmark) {
    setMessage(
      "No landmark in range.",
      player.z > 0.1
        ? "Try the rooftop bridge, relay dishes, or another lit roof node."
        : "Walk closer to a plaza signal, market stall, or storefront to focus on it."
    );
    return;
  }
  setMessage(landmark.title, landmark.body);
}

function updateHUD(time) {
  zoneNameEl.textContent = getCurrentZoneName();
  signalPulse = lerp(signalPulse, 0.55 + Math.sin(time * 1.7) * 0.25, 0.04);
  signalStatusEl.textContent =
    signalPulse > 0.68 ? "Crystal" : signalPulse > 0.46 ? "Stable" : "Noisy";
  discoveryStatusEl.textContent = `${discovered.size} / ${landmarks.length}`;
  if (levelStatusEl) {
    levelStatusEl.textContent = player.z > 0.1 ? `Roof ${player.z.toFixed(0)}` : "Street";
  }
}

function ensureMusicTrack() {
  if (audioState.music) {
    return audioState.music;
  }

  const music = new Audio("./Neon Rain Reverie.mp3");
  music.loop = true;
  music.preload = "auto";
  music.volume = 0;
  music.playsInline = true;
  audioState.music = music;
  return music;
}

function primeAudio() {
  const music = ensureMusicTrack();
  audioState.enabled = true;
  audioState.primed = true;

  const playAttempt = music.play();
  if (playAttempt && typeof playAttempt.then === "function") {
    playAttempt
      .then(() => {
        setMessage(
          "Soundtrack online.",
          "Neon Rain Reverie is now playing over the district. Press M any time to mute or bring it back."
        );
      })
      .catch((error) => {
        setMessage(
          "Soundtrack blocked.",
          `The browser did not start the MP3 yet: ${error.message}`
        );
      });
  }
}

function toggleAudio() {
  const music = ensureMusicTrack();

  if (!audioState.primed) {
    primeAudio();
    return;
  }

  audioState.enabled = !audioState.enabled;
  if (audioState.enabled) {
    const playAttempt = music.play();
    if (playAttempt && typeof playAttempt.then === "function") {
      playAttempt.catch(() => {});
    }
  }

  setMessage(
    audioState.enabled ? "Soundtrack online." : "Soundtrack muted.",
    audioState.enabled
      ? "Neon Rain Reverie is carrying the district again."
      : "The city is still moving, but the soundtrack has been muted."
  );
}

function updateAudio() {
  if (!audioState.music) {
    return;
  }

  const roofBoost = player.z > 0.1 ? 0.05 : 0;
  const crossingBoost = Math.max(0, 1 - Math.hypot(player.x - 15, player.y - 10) / 12) * 0.08;
  audioState.targetVolume = audioState.enabled ? clamp(audioState.baseVolume + roofBoost + crossingBoost, 0, 0.82) : 0;
  audioState.currentVolume = lerp(audioState.currentVolume, audioState.targetVolume, 0.03);
  audioState.music.volume = clamp(audioState.currentVolume, 0, 1);

  if (!audioState.enabled && audioState.music.volume < 0.01 && !audioState.music.paused) {
    audioState.music.pause();
  }
}

function getManualMoveVector() {
  let dx = 0;
  let dy = 0;

  if (keys.has("ArrowUp") || keys.has("w")) {
    dx -= 1;
    dy -= 1;
  }
  if (keys.has("ArrowDown") || keys.has("s")) {
    dx += 1;
    dy += 1;
  }
  if (keys.has("ArrowLeft") || keys.has("a")) {
    dx -= 1;
    dy += 1;
  }
  if (keys.has("ArrowRight") || keys.has("d")) {
    dx += 1;
    dy -= 1;
  }

  dx += inputState.joystickVector.x;
  dy += inputState.joystickVector.y;

  const magnitude = Math.hypot(dx, dy);
  if (magnitude < 0.08) {
    return { x: 0, y: 0, active: false };
  }

  return {
    x: dx / magnitude,
    y: dy / magnitude,
    active: true,
  };
}

function updatePlayer(delta) {
  const manual = getManualMoveVector();
  let desiredX = 0;
  let desiredY = 0;

  if (manual.active) {
    clearMovePath();
    desiredX = manual.x;
    desiredY = manual.y;
  } else if (inputState.movePath.length > 0) {
    const waypoint = inputState.movePath[0];
    const dx = waypoint.x - player.x;
    const dy = waypoint.y - player.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.18) {
      inputState.movePath.shift();
      if (inputState.movePath.length === 0) {
        inputState.moveTarget = null;
      }
    } else {
      desiredX = dx / distance;
      desiredY = dy / distance;
    }
  }

  const acceleration = desiredX !== 0 || desiredY !== 0 ? 12 : 10;
  const damping = Math.exp(-acceleration * delta);
  const targetVx = desiredX * player.speed;
  const targetVy = desiredY * player.speed;
  player.vx = lerp(targetVx, player.vx, damping);
  player.vy = lerp(targetVy, player.vy, damping);

  const moveDistance = Math.hypot(player.vx, player.vy) * delta;
  const subSteps = Math.max(1, Math.ceil(moveDistance / 0.08));
  const stepX = (player.vx * delta) / subSteps;
  const stepY = (player.vy * delta) / subSteps;

  for (let i = 0; i < subSteps; i += 1) {
    const nextX = player.x + stepX;
    const nextY = player.y + stepY;

    if (canOccupy(nextX, player.y, player.z)) {
      player.x = nextX;
    } else {
      player.vx = 0;
    }

    if (canOccupy(player.x, nextY, player.z)) {
      player.y = nextY;
    } else {
      player.vy = 0;
    }
  }

  if (player.z > 0.1) {
    const surface = getSurfaceAt(player.x, player.y, player.z);
    player.surfaceId = surface ? surface.id : player.surfaceId;
  }

  const velocity = Math.hypot(player.vx, player.vy);
  player.bob += delta * (6 + velocity * 1.8);
}

function updateNpcs(delta) {
  for (const npc of npcs) {
    if (!npc.route || npc.route.length < 2) {
      continue;
    }

    if (npc.pause > 0) {
      npc.pause -= delta;
      continue;
    }

    const target = npc.route[npc.routeIndex];
    const dx = target[0] - npc.x;
    const dy = target[1] - npc.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 0.06) {
      npc.routeIndex += npc.routeDirection;
      if (npc.routeIndex >= npc.route.length) {
        npc.routeDirection = -1;
        npc.routeIndex = npc.route.length - 2;
      } else if (npc.routeIndex < 0) {
        npc.routeDirection = 1;
        npc.routeIndex = 1;
      }
      npc.pause = 0.35 + Math.random() * 0.5;
      continue;
    }

    const move = Math.min(distance, npc.speed * delta);
    npc.x += (dx / distance) * move;
    npc.y += (dy / distance) * move;
    npc.bob += delta * 8;
  }
}

function handleWorldPointer(clientX, clientY) {
  const camera = cameraState;
  const worldPoint = screenToWorld(clientX, clientY, player.z, camera);
  setMoveDestination(worldPoint.x, worldPoint.y);
}

function updateJoystickFromEvent(event) {
  if (!thumbBaseEl) {
    return;
  }
  const rect = thumbBaseEl.getBoundingClientRect();
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const maxDistance = rect.width * 0.28;
  const distance = Math.hypot(dx, dy);
  const clamped = distance > maxDistance ? maxDistance / distance : 1;
  setJoystickVector((dx * clamped) / maxDistance, (dy * clamped) / maxDistance);
}

function bindMobileControls() {
  if (!thumbZoneEl || !focusButtonEl || !roofButtonEl || !audioButtonEl) {
    return;
  }

  thumbZoneEl.addEventListener("pointerdown", (event) => {
    inputState.joystickPointerId = event.pointerId;
    thumbZoneEl.setPointerCapture(event.pointerId);
    primeAudio();
    clearMovePath();
    updateJoystickFromEvent(event);
    event.preventDefault();
  });

  thumbZoneEl.addEventListener("pointermove", (event) => {
    if (inputState.joystickPointerId !== event.pointerId) {
      return;
    }
    updateJoystickFromEvent(event);
    event.preventDefault();
  });

  const endJoystick = (event) => {
    if (inputState.joystickPointerId !== event.pointerId) {
      return;
    }
    inputState.joystickPointerId = null;
    setJoystickVector(0, 0);
  };

  thumbZoneEl.addEventListener("pointerup", endJoystick);
  thumbZoneEl.addEventListener("pointercancel", endJoystick);

  focusButtonEl.addEventListener("click", () => {
    primeAudio();
    focusLandmark();
  });
  roofButtonEl.addEventListener("click", () => {
    primeAudio();
    tryToggleAccessPoint();
  });
  audioButtonEl.addEventListener("click", () => {
    toggleAudio();
  });
}

function render(time) {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const targetScreen = {
    x: (player.x - player.y) * TILE_W * 0.5,
    y: (player.x + player.y) * TILE_H * 0.5 - player.z * HEIGHT_UNIT,
  };
  cameraState.x = lerp(cameraState.x, window.innerWidth * 0.5 - targetScreen.x, 0.12);
  cameraState.y = lerp(cameraState.y, window.innerHeight * 0.58 - targetScreen.y, 0.12);
  const camera = cameraState;

  drawBackground(camera, time);

  const floorItems = [...tiles].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const tile of floorItems) {
    drawTile(tile, camera, time);
  }

  drawLandmarkBeacons(camera, time);

  for (const building of buildings) {
    drawExtrudedBox(building, camera);
  }

  for (const surface of roofSurfaces) {
    if (surface.kind === "bridge") {
      drawRoofBridge(surface, camera, time);
    }
  }

  const propDrawers = {
    lamp: drawLamp,
    vending: drawVending,
    steam: drawSteam,
    tree: drawTree,
    gate: drawGate,
    billboard: drawBillboard,
    access: drawAccess,
  };

  const sceneItems = [
    ...props.map((prop) => ({ kind: "prop", sort: prop.x + prop.y + (prop.z || 0), prop })),
    ...npcs.map((npc) => ({ kind: "npc", sort: npc.x + npc.y, npc })),
    { kind: "player", sort: player.x + player.y + (player.z > 0 ? 2 : 0) },
  ].sort((a, b) => a.sort - b.sort);

  for (const item of sceneItems) {
    if (item.kind === "prop") {
      propDrawers[item.prop.kind](item.prop, camera, time);
    } else if (item.kind === "npc") {
      drawNpc(item.npc, camera, time);
    } else {
      drawPlayer(camera, time);
    }
  }

  drawRain(time);
}

function tick(timestamp) {
  const time = timestamp * 0.001;
  const delta = clamp((timestamp - lastTime) * 0.001, 0, 0.033);
  lastTime = timestamp;

  updatePlayer(delta);
  updateNpcs(delta);
  pulseNearbyLandmark();
  updateHUD(time);
  updateAudio(time);
  render(time);
  requestAnimationFrame(tick);
}

window.addEventListener("resize", resize);
canvas.addEventListener("pointerdown", (event) => {
  primeAudio();
  handleWorldPointer(event.clientX, event.clientY);
});
window.addEventListener("keydown", (event) => {
  keys.add(event.key);
  keys.add(event.key.toLowerCase());

  if (event.code === "Space") {
    primeAudio();
    focusLandmark();
    event.preventDefault();
  } else if (event.key.toLowerCase() === "r") {
    primeAudio();
    tryToggleAccessPoint();
    event.preventDefault();
  } else if (event.key.toLowerCase() === "m") {
    toggleAudio();
    event.preventDefault();
  } else {
    primeAudio();
  }
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.key);
  keys.delete(event.key.toLowerCase());
});

setupWorld();
ensureSafeSpawn();
resize();
bindHudCarousel();
bindMobileControls();
setMessage(defaultMessage.title, defaultMessage.body);
requestAnimationFrame(tick);
