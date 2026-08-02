const SONY_VENDOR_ID = 0x054c;
const DUALSENSE_PRODUCT_ID = 0x0ce6;
const TOUCH_MAX_X = 1919;
const TOUCH_MAX_Y = 1079;
const BT_REPORT_ID = 0x31;
const BT_REPORT_SIZE = 77;
const USB_REPORT_ID = 0x01;
const USB_REPORT_SIZE = 63;

const $ = (id) => document.getElementById(id);
const ui = {
  connectButton: $("connectButton"), connectionBadge: $("connectionBadge"), deviceName: $("deviceName"),
  connectionType: $("connectionType"), reportInfo: $("reportInfo"), reportRate: $("reportRate"),
  featureStatus: $("featureStatus"), lastReceived: $("lastReceived"), buttonGrid: $("buttonGrid"),
  leftStickDot: $("leftStickDot"), rightStickDot: $("rightStickDot"), leftX: $("leftX"), leftY: $("leftY"),
  rightX: $("rightX"), rightY: $("rightY"), leftRaw: $("leftRaw"), rightRaw: $("rightRaw"),
  l2Bar: $("l2Bar"), r2Bar: $("r2Bar"), l2Value: $("l2Value"), r2Value: $("r2Value"),
  l2Raw: $("l2Raw"), r2Raw: $("r2Raw"), dpadValue: $("dpadValue"), buttonsRaw: $("buttonsRaw"),
  touchSurface: $("touchSurface"), touchDot0: $("touchDot0"), touchDot1: $("touchDot1"),
  touch0State: $("touch0State"), touch0Id: $("touch0Id"), touch0XY: $("touch0XY"),
  touch1State: $("touch1State"), touch1Id: $("touch1Id"), touch1XY: $("touch1XY"),
  gyroX: $("gyroX"), gyroY: $("gyroY"), gyroZ: $("gyroZ"), accelX: $("accelX"),
  accelY: $("accelY"), accelZ: $("accelZ"), sequence: $("sequence"), sensorTimestamp: $("sensorTimestamp"),
  batteryRaw: $("batteryRaw"), batteryLevel: $("batteryLevel"), rawBytes: $("rawBytes"), copyButton: $("copyButton"),
};

const buttonNames = [
  "↑", "↗", "→", "↘", "↓", "↙", "←", "↖",
  "Square", "Cross", "Circle", "Triangle", "L1", "R1", "L2 Button", "R2 Button",
  "Create", "Options", "L3", "R3", "PS", "Touchpad Click", "Mute"
];
const buttonElements = new Map();
for (const name of buttonNames) {
  const item = document.createElement("div");
  item.className = "button-pill";
  item.textContent = name;
  ui.buttonGrid.appendChild(item);
  buttonElements.set(name, item);
}

let device = null;
let latestRawText = "待機中";
let reportTimes = [];
let btOutputSequence = 1;

function setConnectionStatus(text, kind = "off") {
  ui.connectionBadge.textContent = text;
  ui.connectionBadge.className = `badge ${kind}`;
}

function hex(value, width = 2) {
  return value.toString(16).padStart(width, "0");
}

function normalizeAxis(raw) {
  const value = (raw - 127.5) / 127.5;
  return Math.max(-1, Math.min(1, value));
}

function signed16(view, offset) {
  return view.getInt16(offset, true);
}

function updateStick(dot, x, y) {
  dot.style.left = `${(x + 1) * 50}%`;
  dot.style.top = `${(y + 1) * 50}%`;
}

function setButton(name, active) {
  buttonElements.get(name)?.classList.toggle("active", Boolean(active));
}

function decodeDpad(value) {
  const states = {
    0: ["↑"], 1: ["↑", "→", "↗"], 2: ["→"], 3: ["→", "↓", "↘"],
    4: ["↓"], 5: ["↓", "←", "↙"], 6: ["←"], 7: ["←", "↑", "↖"], 8: []
  };
  for (const name of ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"]) setButton(name, states[value]?.includes(name));
  const labels = ["上", "右上", "右", "右下", "下", "左下", "左", "左上", "中立"];
  ui.dpadValue.textContent = `${value}（${labels[value] ?? "不明"}）`;
}

function parseTouch(view, offset) {
  if (offset + 4 > view.byteLength) return null;
  const contact = view.getUint8(offset);
  const xLow = view.getUint8(offset + 1);
  const packed = view.getUint8(offset + 2);
  const yHigh = view.getUint8(offset + 3);
  return {
    active: (contact & 0x80) === 0,
    id: contact & 0x7f,
    x: xLow | ((packed & 0x0f) << 8),
    y: ((packed & 0xf0) >> 4) | (yHigh << 4),
  };
}

function renderTouch(point, index) {
  const dot = index === 0 ? ui.touchDot0 : ui.touchDot1;
  const stateEl = index === 0 ? ui.touch0State : ui.touch1State;
  const idEl = index === 0 ? ui.touch0Id : ui.touch1Id;
  const xyEl = index === 0 ? ui.touch0XY : ui.touch1XY;
  if (!point) {
    dot.hidden = true;
    stateEl.textContent = "データなし";
    idEl.textContent = "—";
    xyEl.textContent = "— / —";
    return;
  }
  stateEl.textContent = point.active ? "接触中" : "非接触";
  idEl.textContent = String(point.id);
  xyEl.textContent = `${point.x} / ${point.y}`;
  dot.hidden = !point.active;
  if (point.active) {
    dot.style.left = `${Math.max(0, Math.min(100, point.x / TOUCH_MAX_X * 100))}%`;
    dot.style.top = `${Math.max(0, Math.min(100, point.y / TOUCH_MAX_Y * 100))}%`;
  }
}

function renderRaw(reportId, data) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const lines = [`Report ID: 0x${hex(reportId)} / payload: ${bytes.length} bytes`];
  for (let i = 0; i < bytes.length; i += 16) {
    lines.push(Array.from(bytes.slice(i, i + 16))
      .map((value, j) => `${String(i + j).padStart(2, "0")}:${hex(value)}`)
      .join("  "));
  }
  latestRawText = lines.join("\n");
  ui.rawBytes.textContent = latestRawText;
}

function updateReportRate() {
  const now = performance.now();
  reportTimes.push(now);
  reportTimes = reportTimes.filter((time) => now - time <= 1000);
  if (reportTimes.length >= 2) {
    const spanSeconds = (reportTimes.at(-1) - reportTimes[0]) / 1000;
    ui.reportRate.textContent = `${(reportTimes.length - 1) / Math.max(spanSeconds, 0.001).toFixed ? "" : ""}`;
    const hz = (reportTimes.length - 1) / Math.max(spanSeconds, 0.001);
    ui.reportRate.textContent = `${hz.toFixed(1)} Hz`;
  }
}

function parseCommonReport(reportId, data) {
  let commonOffset;
  let type;
  if (reportId === BT_REPORT_ID && data.byteLength === BT_REPORT_SIZE) {
    commonOffset = 1;
    type = "Bluetooth拡張入力";
  } else if (reportId === USB_REPORT_ID && data.byteLength === USB_REPORT_SIZE) {
    commonOffset = 0;
    type = "USB入力";
  } else {
    return false;
  }

  ui.connectionType.textContent = type;
  const lxRaw = data.getUint8(commonOffset + 0);
  const lyRaw = data.getUint8(commonOffset + 1);
  const rxRaw = data.getUint8(commonOffset + 2);
  const ryRaw = data.getUint8(commonOffset + 3);
  const l2Raw = data.getUint8(commonOffset + 4);
  const r2Raw = data.getUint8(commonOffset + 5);
  const lx = normalizeAxis(lxRaw);
  const ly = normalizeAxis(lyRaw);
  const rx = normalizeAxis(rxRaw);
  const ry = normalizeAxis(ryRaw);

  ui.leftX.textContent = lx.toFixed(3); ui.leftY.textContent = ly.toFixed(3);
  ui.rightX.textContent = rx.toFixed(3); ui.rightY.textContent = ry.toFixed(3);
  ui.leftRaw.textContent = `${lxRaw} / ${lyRaw}`; ui.rightRaw.textContent = `${rxRaw} / ${ryRaw}`;
  updateStick(ui.leftStickDot, lx, ly); updateStick(ui.rightStickDot, rx, ry);
  ui.l2Value.textContent = (l2Raw / 255).toFixed(3); ui.r2Value.textContent = (r2Raw / 255).toFixed(3);
  ui.l2Raw.textContent = `Raw ${l2Raw}`; ui.r2Raw.textContent = `Raw ${r2Raw}`;
  ui.l2Bar.style.height = `${l2Raw / 255 * 100}%`; ui.r2Bar.style.height = `${r2Raw / 255 * 100}%`;

  const sequence = data.getUint8(commonOffset + 6);
  const b0 = data.getUint8(commonOffset + 7);
  const b1 = data.getUint8(commonOffset + 8);
  const b2 = data.getUint8(commonOffset + 9);
  const b3 = data.getUint8(commonOffset + 10);
  const dpad = b0 & 0x0f;
  decodeDpad(dpad);
  setButton("Square", b0 & 0x10); setButton("Cross", b0 & 0x20); setButton("Circle", b0 & 0x40); setButton("Triangle", b0 & 0x80);
  setButton("L1", b1 & 0x01); setButton("R1", b1 & 0x02); setButton("L2 Button", b1 & 0x04); setButton("R2 Button", b1 & 0x08);
  setButton("Create", b1 & 0x10); setButton("Options", b1 & 0x20); setButton("L3", b1 & 0x40); setButton("R3", b1 & 0x80);
  setButton("PS", b2 & 0x01); setButton("Touchpad Click", b2 & 0x02); setButton("Mute", b2 & 0x04);
  ui.buttonsRaw.textContent = `${hex(b0)} ${hex(b1)} ${hex(b2)} ${hex(b3)}`;
  ui.sequence.textContent = String(sequence);

  ui.gyroX.textContent = String(signed16(data, commonOffset + 15));
  ui.gyroY.textContent = String(signed16(data, commonOffset + 17));
  ui.gyroZ.textContent = String(signed16(data, commonOffset + 19));
  ui.accelX.textContent = String(signed16(data, commonOffset + 21));
  ui.accelY.textContent = String(signed16(data, commonOffset + 23));
  ui.accelZ.textContent = String(signed16(data, commonOffset + 25));
  ui.sensorTimestamp.textContent = String(data.getUint32(commonOffset + 27, true));

  renderTouch(parseTouch(data, commonOffset + 32), 0);
  renderTouch(parseTouch(data, commonOffset + 36), 1);

  if (commonOffset + 52 < data.byteLength) {
    const status = data.getUint8(commonOffset + 52);
    const level = Math.min(10, status & 0x0f);
    const chargeState = (status >> 4) & 0x0f;
    ui.batteryRaw.textContent = `0x${hex(status)}（状態 ${chargeState}）`;
    ui.batteryLevel.textContent = `${level * 10}%（推定）`;
  }
  return true;
}

function parseBasicBluetooth(data) {
  if (data.byteLength < 9) return;
  ui.connectionType.textContent = "Bluetooth基本入力（0x31待機中）";
  const values = [0, 1, 2, 3].map((offset) => data.getUint8(offset));
  const normalized = values.map(normalizeAxis);
  ui.leftX.textContent = normalized[0].toFixed(3); ui.leftY.textContent = normalized[1].toFixed(3);
  ui.rightX.textContent = normalized[2].toFixed(3); ui.rightY.textContent = normalized[3].toFixed(3);
  ui.leftRaw.textContent = `${values[0]} / ${values[1]}`; ui.rightRaw.textContent = `${values[2]} / ${values[3]}`;
  updateStick(ui.leftStickDot, normalized[0], normalized[1]); updateStick(ui.rightStickDot, normalized[2], normalized[3]);
}

function handleInputReport(event) {
  const { reportId, data } = event;
  ui.reportInfo.textContent = `0x${hex(reportId)} / ${data.byteLength} bytes`;
  ui.lastReceived.textContent = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  updateReportRate();
  renderRaw(reportId, data);
  if (!parseCommonReport(reportId, data) && reportId === 0x01) parseBasicBluetooth(data);
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
}
const crcTable = makeCrcTable();
function bluetoothCrc(payload) {
  let crc = 0xffffffff;
  const update = (byte) => { crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); };
  update(0xa2); update(0x31);
  for (let i = 0; i < 73; i += 1) update(payload[i]);
  return (crc ^ 0xffffffff) >>> 0;
}
async function sendBluetoothFallback(target) {
  const payload = new Uint8Array(77);
  payload[0] = (btOutputSequence++ & 0x0f) << 4;
  payload[1] = 0x10;
  payload[2] = 0x03;
  new DataView(payload.buffer).setUint32(73, bluetoothCrc(payload), true);
  await target.sendReport(0x31, payload);
}

async function enableExtendedBluetoothInput(target) {
  ui.featureStatus.textContent = "0x05読取中";
  try {
    const report = await target.receiveFeatureReport(0x05);
    ui.featureStatus.textContent = `0x05成功（${report.byteLength} bytes）`;
  } catch (error) {
    ui.featureStatus.textContent = `0x05失敗: ${error.message}`;
  }
  try { await sendBluetoothFallback(target); } catch (error) { console.warn("Bluetooth fallback failed", error); }
}

async function attachDevice(target) {
  if (!target.opened) await target.open();
  if (device) device.removeEventListener("inputreport", handleInputReport);
  device = target;
  device.addEventListener("inputreport", handleInputReport);
  ui.deviceName.textContent = target.productName || "Wireless Controller";
  setConnectionStatus("接続中", "on");
  ui.connectButton.textContent = "再接続";
  await enableExtendedBluetoothInput(target);
}

async function requestDevice() {
  if (!("hid" in navigator)) {
    setConnectionStatus("WebHID非対応", "error");
    return;
  }
  try {
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: SONY_VENDOR_ID, productId: DUALSENSE_PRODUCT_ID }] });
    if (devices.length) await attachDevice(devices[0]);
  } catch (error) {
    setConnectionStatus("接続失敗", "error");
    ui.deviceName.textContent = error.message;
  }
}

ui.connectButton.addEventListener("click", requestDevice);
ui.copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(latestRawText);
  const original = ui.copyButton.textContent;
  ui.copyButton.textContent = "コピーしました";
  setTimeout(() => { ui.copyButton.textContent = original; }, 1200);
});

if ("hid" in navigator) {
  navigator.hid.addEventListener("disconnect", (event) => {
    if (event.device !== device) return;
    device = null;
    setConnectionStatus("切断", "off");
    ui.connectionType.textContent = "—";
  });
  navigator.hid.getDevices().then((devices) => {
    const allowed = devices.find((item) => item.vendorId === SONY_VENDOR_ID && item.productId === DUALSENSE_PRODUCT_ID);
    if (allowed) attachDevice(allowed).catch(console.error);
  });
} else {
  setConnectionStatus("WebHID非対応", "error");
  ui.connectButton.disabled = true;
}
