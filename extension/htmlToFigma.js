function htmlToFigma(selector = "body", useFrames = false, time = false) {
  if (time) {
      console.time("Parse dom");
  }
  function getAppliedComputedStyles(element, pseudo) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
          return {};
      }
      const styles = getComputedStyle(element, pseudo);
      const list = [
          "opacity",
          "backgroundColor",
          "border",
          "borderTop",
          "borderLeft",
          "borderRight",
          "borderBottom",
          "borderRadius",
          "backgroundImage",
          "borderColor",
          "boxShadow"
      ];
      const color = styles.color;
      const defaults = {
          transform: "none",
          opacity: "1",
          borderRadius: "0px",
          backgroundImage: "none",
          backgroundPosition: "0% 0%",
          backgroundSize: "auto",
          backgroundColor: "rgba(0, 0, 0, 0)",
          backgroundAttachment: "scroll",
          border: "0px none " + color,
          borderTop: "0px none " + color,
          borderBottom: "0px none " + color,
          borderLeft: "0px none " + color,
          borderRight: "0px none " + color,
          borderWidth: "0px",
          borderColor: color,
          borderStyle: "none",
          boxShadow: "none",
          fontWeight: "400",
          textAlign: "start",
          justifyContent: "normal",
          alignItems: "normal",
          alignSelf: "auto",
          flexGrow: "0",
          textDecoration: "none solid " + color,
          lineHeight: "normal",
          letterSpacing: "normal",
          backgroundRepeat: "repeat",
          zIndex: "auto" // TODO
      };
      function pick(object, paths) {
          const newObject = {};
          paths.forEach(path => {
              if (object[path]) {
                  if (object[path] !== defaults[path]) {
                      newObject[path] = object[path];
                  }
              }
          });
          return newObject;
      }
      return pick(styles, list);
  }
  function size(obj) {
      return Object.keys(obj).length;
  }
  const layers = [];
  const el = document.querySelector(selector || "body");
  function textNodesUnder(el) {
      let n = null;
      const a = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      while ((n = walk.nextNode())) {
          a.push(n);
      }
      return a;
  }
  const parseUnits = (str) => {
      if (!str) {
          return null;
      }
      const match = str.match(/([\d\.]+)px/);
      const val = match && match[1];
      if (val) {
          return {
              unit: "PIXELS",
              value: parseFloat(val)
          };
      }
      return null;
  };
  function isHidden(element) {
      let el = element;
      do {
          const computed = getComputedStyle(el);
          if (
          // computed.opacity === '0' ||
          computed.display === "none" ||
              computed.visibility === "hidden") {
              return true;
          }
      } while ((el = el.parentElement));
      return false;
  }
  if (el) {
      // Process SVG <use> elements
      for (const use of Array.from(el.querySelectorAll("use"))) {
          try {
              const symbolSelector = use.href.baseVal;
              const symbol = document.querySelector(symbolSelector);
              if (symbol) {
                  use.outerHTML = symbol.innerHTML;
              }
          }
          catch (err) {
              console.warn("Error querying <use> tag href", err);
          }
      }
      const els = Array.from(el.querySelectorAll("*"));
      if (els) {
          // Include shadow dom
          // for (const el of els) {
          //   if (el.shadowRoot) {
          //     const shadowEls = Array.from(el.shadowRoot.querySelectorAll('*'));
          //     els.push(...shadowEls);
          //   }
          // }
          Array.from(els).forEach(el => {
              if (isHidden(el)) {
                  return;
              }
              if (el instanceof SVGSVGElement) {
                  const rect = el.getBoundingClientRect();
                  // TODO: pull in CSS/computed styles
                  // TODO: may need to pull in layer styles too like shadow, bg color, etc
                  layers.push({
                      type: "SVG",
                      ref: el,
                      svg: el.outerHTML,
                      x: Math.round(rect.left),
                      y: Math.round(rect.top),
                      width: Math.round(rect.width),
                      height: Math.round(rect.height)
                  });
                  return;
              }
              // Sub SVG Eleemnt
              else if (el instanceof SVGElement) {
                  return;
              }
              const appliedStyles = getAppliedComputedStyles(el);
              const computedStyle = getComputedStyle(el);
              if ((size(appliedStyles) ||
                  el instanceof HTMLImageElement ||
                  el instanceof HTMLVideoElement) &&
                  computedStyle.display !== "none") {
                  const rect = el.getBoundingClientRect();
                  if (rect.width >= 1 && rect.height >= 1) {
                      const fills = [];
                      const color = getRgb(computedStyle.backgroundColor);
                      if (color) {
                          fills.push({
                              type: "SOLID",
                              color: {
                                  r: color.r,
                                  g: color.g,
                                  b: color.b
                              },
                              opacity: color.a || 1
                          });
                      }
                      const rectNode = {
                          type: "RECTANGLE",
                          ref: el,
                          x: Math.round(rect.left),
                          y: Math.round(rect.top),
                          width: Math.round(rect.width),
                          height: Math.round(rect.height),
                          fills: fills
                      };
                      if (computedStyle.border) {
                          const parsed = computedStyle.border.match(/^([\d\.]+)px\s*(\w+)\s*(.*)$/);
                          if (parsed) {
                              let [_match, width, type, color] = parsed;
                              if (width && width !== "0" && type !== "none" && color) {
                                  const rgb = getRgb(color);
                                  if (rgb) {
                                      rectNode.strokes = [
                                          {
                                              type: "SOLID",
                                              color: { r: rgb.r, b: rgb.b, g: rgb.g },
                                              opacity: rgb.a || 1
                                          }
                                      ];
                                      rectNode.strokeWeight = Math.round(parseFloat(width));
                                  }
                              }
                          }
                      }
                      if (!rectNode.strokes) {
                          const capitalize = (str) => str[0].toUpperCase() + str.substring(1);
                          const directions = ["top", "left", "right", "bottom"];
                          for (const dir of directions) {
                              const computed = computedStyle[("border" + capitalize(dir))];
                              if (computed) {
                                  const parsed = computed.match(/^([\d\.]+)px\s*(\w+)\s*(.*)$/);
                                  if (parsed) {
                                      let [_match, borderWidth, type, color] = parsed;
                                      if (borderWidth &&
                                          borderWidth !== "0" &&
                                          type !== "none" &&
                                          color) {
                                          const rgb = getRgb(color);
                                          if (rgb) {
                                              const width = ["top", "bottom"].includes(dir)
                                                  ? rect.width
                                                  : parseFloat(borderWidth);
                                              const height = ["left", "right"].includes(dir)
                                                  ? rect.height
                                                  : parseFloat(borderWidth);
                                              layers.push({
                                                  ref: el,
                                                  type: "RECTANGLE",
                                                  x: dir === "left"
                                                      ? rect.left - width
                                                      : dir === "right"
                                                          ? rect.right
                                                          : rect.left,
                                                  y: dir === "top"
                                                      ? rect.top - height
                                                      : dir === "bottom"
                                                          ? rect.bottom
                                                          : rect.top,
                                                  width,
                                                  height,
                                                  fills: [
                                                      {
                                                          type: "SOLID",
                                                          color: { r: rgb.r, b: rgb.b, g: rgb.g },
                                                          opacity: rgb.a || 1
                                                      }
                                                  ]
                                              });
                                          }
                                      }
                                  }
                              }
                          }
                      }
                      if (computedStyle.backgroundImage &&
                          computedStyle.backgroundImage !== "none") {
                          const urlMatch = computedStyle.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
                          const url = urlMatch && urlMatch[1];
                          if (url) {
                              fills.push({
                                  url,
                                  type: "IMAGE",
                                  // TODO: backround size, position
                                  scaleMode: computedStyle.backgroundSize === "contain" ? "FIT" : "FILL",
                                  imageHash: null
                              });
                          }
                      }
                      if (el instanceof SVGSVGElement) {
                          const url = `data:image/svg+xml,${encodeURIComponent(el.outerHTML.replace(/\s+/g, " "))}`;
                          if (url) {
                              fills.push({
                                  url,
                                  type: "IMAGE",
                                  // TODO: object fit, position
                                  scaleMode: "FILL",
                                  imageHash: null
                              });
                          }
                      }
                      if (el instanceof HTMLImageElement) {
                          const url = el.src;
                          if (url) {
                              fills.push({
                                  url,
                                  type: "IMAGE",
                                  // TODO: object fit, position
                                  scaleMode: computedStyle.objectFit === "contain" ? "FIT" : "FILL",
                                  imageHash: null
                              });
                          }
                      }
                      if (el instanceof HTMLVideoElement) {
                          const url = el.poster;
                          if (url) {
                              fills.push({
                                  url,
                                  type: "IMAGE",
                                  // TODO: object fit, position
                                  scaleMode: computedStyle.objectFit === "contain" ? "FIT" : "FILL",
                                  imageHash: null
                              });
                          }
                      }
                      if (computedStyle.boxShadow && computedStyle.boxShadow !== "none") {
                          const LENGTH_REG = /^[0-9]+[a-zA-Z%]+?$/;
                          const toNum = (v) => {
                              // if (!/px$/.test(v) && v !== '0') return v;
                              if (!/px$/.test(v) && v !== "0")
                                  return 0;
                              const n = parseFloat(v);
                              // return !isNaN(n) ? n : v;
                              return !isNaN(n) ? n : 0;
                          };
                          const isLength = (v) => v === "0" || LENGTH_REG.test(v);
                          const parseValue = (str) => {
                              // TODO: this is broken for multiple box shadows
                              if (str.startsWith("rgb")) {
                                  // Werid computed style thing that puts the color in the front not back
                                  const colorMatch = str.match(/(rgba?\(.+?\))(.+)/);
                                  if (colorMatch) {
                                      str = (colorMatch[2] + " " + colorMatch[1]).trim();
                                  }
                              }
                              const PARTS_REG = /\s(?![^(]*\))/;
                              const parts = str.split(PARTS_REG);
                              const inset = parts.includes("inset");
                              const last = parts.slice(-1)[0];
                              const color = !isLength(last) ? last : "rgba(0, 0, 0, 1)";
                              const nums = parts
                                  .filter(n => n !== "inset")
                                  .filter(n => n !== color)
                                  .map(toNum);
                              const [offsetX, offsetY, blurRadius, spreadRadius] = nums;
                              return {
                                  inset,
                                  offsetX,
                                  offsetY,
                                  blurRadius,
                                  spreadRadius,
                                  color
                              };
                          };
                          const parsed = parseValue(computedStyle.boxShadow);
                          const color = getRgb(parsed.color);
                          if (color) {
                              rectNode.effects = [
                                  {
                                      color,
                                      type: "DROP_SHADOW",
                                      radius: parsed.blurRadius,
                                      blendMode: "NORMAL",
                                      visible: true,
                                      offset: {
                                          x: parsed.offsetX,
                                          y: parsed.offsetY
                                      }
                                  }
                              ];
                          }
                      }
                      const borderTopLeftRadius = parseUnits(computedStyle.borderTopLeftRadius);
                      if (borderTopLeftRadius) {
                          rectNode.topLeftRadius = borderTopLeftRadius.value;
                      }
                      const borderTopRightRadius = parseUnits(computedStyle.borderTopRightRadius);
                      if (borderTopRightRadius) {
                          rectNode.topRightRadius = borderTopRightRadius.value;
                      }
                      const borderBottomRightRadius = parseUnits(computedStyle.borderBottomRightRadius);
                      if (borderBottomRightRadius) {
                          rectNode.bottomRightRadius = borderBottomRightRadius.value;
                      }
                      const borderBottomLeftRadius = parseUnits(computedStyle.borderBottomLeftRadius);
                      if (borderBottomLeftRadius) {
                          rectNode.bottomLeftRadius = borderBottomLeftRadius.value;
                      }
                      layers.push(rectNode);
                  }
              }
          });
      }
      const textNodes = textNodesUnder(el);
      function getRgb(colorString) {
          if (!colorString) {
              return null;
          }
          const [_1, r, g, b, _2, a] = (colorString.match(/rgba?\(([\d\.]+), ([\d\.]+), ([\d\.]+)(, ([\d\.]+))?\)/) || []);
          const none = a && parseFloat(a) === 0;
          if (r && g && b && !none) {
              return {
                  r: parseInt(r) / 255,
                  g: parseInt(g) / 255,
                  b: parseInt(b) / 255,
                  a: a ? parseFloat(a) : 1
              };
          }
          return null;
      }
      const fastClone = (data) => JSON.parse(JSON.stringify(data));
      for (const node of textNodes) {
          if (node.textContent && node.textContent.trim().length) {
              const parent = node.parentElement;
              if (parent) {
                  if (isHidden(parent)) {
                      continue;
                  }
                  const computedStyles = getComputedStyle(parent);
                  const range = document.createRange();
                  range.selectNode(node);
                  const rect = fastClone(range.getBoundingClientRect());
                  const lineHeight = parseUnits(computedStyles.lineHeight);
                  range.detach();
                  if (lineHeight && rect.height < lineHeight.value) {
                      const delta = lineHeight.value - rect.height;
                      rect.top -= delta / 2;
                      rect.height = lineHeight.value;
                  }
                  if (rect.height < 1 || rect.width < 1) {
                      continue;
                  }
                  const textNode = {
                      x: Math.round(rect.left),
                      ref: node,
                      y: Math.round(rect.top),
                      width: Math.round(rect.width),
                      height: Math.round(rect.height),
                      type: "TEXT",
                      characters: node.textContent.trim().replace(/\s+/g, " ") || ""
                  };
                  const fills = [];
                  const rgb = getRgb(computedStyles.color);
                  if (rgb) {
                      fills.push({
                          type: "SOLID",
                          color: {
                              r: rgb.r,
                              g: rgb.g,
                              b: rgb.b
                          },
                          opacity: rgb.a || 1
                      });
                  }
                  if (fills.length) {
                      textNode.fills = fills;
                  }
                  const letterSpacing = parseUnits(computedStyles.letterSpacing);
                  if (letterSpacing) {
                      textNode.letterSpacing = letterSpacing;
                  }
                  if (lineHeight) {
                      textNode.lineHeight = lineHeight;
                  }
                  const { textTransform } = computedStyles;
                  switch (textTransform) {
                      case "uppercase": {
                          textNode.textCase = "UPPER";
                          break;
                      }
                      case "lowercase": {
                          textNode.textCase = "LOWER";
                          break;
                      }
                      case "capitalize": {
                          textNode.textCase = "TITLE";
                          break;
                      }
                  }
                  const fontSize = parseUnits(computedStyles.fontSize);
                  if (fontSize) {
                      textNode.fontSize = Math.round(fontSize.value);
                  }
                  if (computedStyles.fontFamily) {
                      // const font = computedStyles.fontFamily.split(/\s*,\s*/);
                      textNode.fontFamily = computedStyles.fontFamily;
                  }
                  if (computedStyles.textDecoration) {
                      if (computedStyles.textDecoration === "underline" ||
                          computedStyles.textDecoration === "strikethrough") {
                          textNode.textDecoration = computedStyles.textDecoration.toUpperCase();
                      }
                  }
                  if (computedStyles.textAlign) {
                      if (["left", "center", "right", "justified"].includes(computedStyles.textAlign)) {
                          textNode.textAlignHorizontal = computedStyles.textAlign.toUpperCase();
                      }
                  }
                  layers.push(textNode);
              }
          }
      }
  }
  // TODO: send frame: { children: []}
  const root = {
      type: "FRAME",
      width: Math.round(window.innerWidth),
      height: Math.round(document.documentElement.scrollHeight),
      x: 0,
      y: 0,
      ref: document.body
  };
  layers.unshift(root);
  const hasChildren = (node) => node && Array.isArray(node.children);
  function traverse(layer, cb, parent) {
      if (layer) {
          cb(layer, parent);
          if (hasChildren(layer)) {
              layer.children.forEach(child => traverse(child, cb, layer));
          }
      }
  }
  function makeTree() {
      function getParent(layer) {
          let response = null;
          try {
              traverse(root, child => {
                  if (child &&
                      child.children &&
                      child.children.includes(layer)) {
                      response = child;
                      // Deep traverse short circuit hack
                      throw "DONE";
                  }
              });
          }
          catch (err) {
              if (err === "DONE") {
                  // Do nothing
              }
              else {
                  console.error(err.message);
              }
          }
          return response;
      }
      const refMap = new WeakMap();
      layers.forEach(layer => {
          if (layer.ref) {
              refMap.set(layer.ref, layer);
          }
      });
      let updated = true;
      let iterations = 0;
      while (updated) {
          updated = false;
          if (iterations++ > 10000) {
              console.error("Too many tree iterations 1");
              break;
          }
          traverse(root, (layer, originalParent) => {
              // const node = layer.ref!;
              const node = layer.ref;
              let parentElement = (node && node.parentElement) || null;
              do {
                  if (parentElement === document.body) {
                      break;
                  }
                  if (parentElement && parentElement !== document.body) {
                      // Get least common demoninator shared parent and make a group
                      const parentLayer = refMap.get(parentElement);
                      if (parentLayer === originalParent) {
                          break;
                      }
                      if (parentLayer && parentLayer !== root) {
                          if (hasChildren(parentLayer)) {
                              if (originalParent) {
                                  const index = originalParent.children.indexOf(layer);
                                  originalParent.children.splice(index, 1);
                                  parentLayer.children.push(layer);
                                  updated = true;
                                  return;
                              }
                          }
                          else {
                              let parentRef = parentLayer.ref;
                              if (parentRef &&
                                  parentRef instanceof Node &&
                                  parentRef.nodeType === Node.TEXT_NODE) {
                                  parentRef = parentRef.parentElement;
                              }
                              const overflowHidden = parentRef instanceof Element &&
                                  getComputedStyle(parentRef).overflow !== "visible";
                              const newParent = {
                                  type: "FRAME",
                                  clipsContent: !!overflowHidden,
                                  // type: 'GROUP',
                                  x: parentLayer.x,
                                  y: parentLayer.y,
                                  width: parentLayer.width,
                                  height: parentLayer.height,
                                  ref: parentLayer.ref,
                                  backgrounds: [],
                                  children: [parentLayer, layer]
                              };
                              const parent = getParent(parentLayer);
                              if (!parent) {
                                  console.warn("\n\nCANT FIND PARENT\n", JSON.stringify(Object.assign({}, parentLayer, { ref: null })));
                                  continue;
                              }
                              if (originalParent) {
                                  const index = originalParent.children.indexOf(layer);
                                  originalParent.children.splice(index, 1);
                              }
                              delete parentLayer.ref;
                              const newIndex = parent.children.indexOf(parentLayer);
                              refMap.set(parentElement, newParent);
                              parent.children.splice(newIndex, 1, newParent);
                              updated = true;
                              return;
                          }
                      }
                  }
              } while (parentElement &&
                  (parentElement = parentElement.parentElement));
          });
      }
      // Collect tree of depeest common parents and make groups
      let secondUpdate = true;
      let secondIterations = 0;
      while (secondUpdate) {
          if (secondIterations++ > 10000) {
              console.error("Too many tree iterations 2");
              break;
          }
          secondUpdate = false;
          function getParents(node) {
              let el = node instanceof Node && node.nodeType === Node.TEXT_NODE
                  ? node.parentElement
                  : node;
              let parents = [];
              while (el && (el = el.parentElement)) {
                  parents.push(el);
              }
              return parents;
          }
          function getDepth(node) {
              return getParents(node).length;
          }
          traverse(root, (layer, parent) => {
              if (secondUpdate) {
                  return;
              }
              if (layer.type === "FRAME") {
                  // Final all child elements with layers, and add groups around  any with a shared parent not shared by another
                  const ref = layer.ref;
                  if (layer.children && layer.children.length > 2) {
                      const childRefs = layer.children &&
                          layer.children.map(child => child.ref);
                      let lowestCommonDenominator = layer.ref;
                      let lowestCommonDenominatorDepth = getDepth(lowestCommonDenominator);
                      // Find lowest common demoninator with greatest depth
                      for (const childRef of childRefs) {
                          const otherChildRefs = childRefs.filter(item => item !== childRef);
                          const childParents = getParents(childRef);
                          for (const otherChildRef of otherChildRefs) {
                              const otherParents = getParents(otherChildRef);
                              for (const parent of otherParents) {
                                  if (childParents.includes(parent) &&
                                      layer.ref.contains(parent)) {
                                      const depth = getDepth(parent);
                                      if (depth > lowestCommonDenominatorDepth) {
                                          lowestCommonDenominator = parent;
                                          lowestCommonDenominatorDepth = depth;
                                      }
                                  }
                              }
                          }
                      }
                      if (lowestCommonDenominator &&
                          lowestCommonDenominator !== layer.ref) {
                          // Make a group around all children elements
                          const newChildren = layer.children.filter((item) => lowestCommonDenominator.contains(item.ref));
                          if (newChildren.length !== layer.children.length) {
                              const lcdRect = lowestCommonDenominator.getBoundingClientRect();
                              const overflowHidden = lowestCommonDenominator instanceof Element &&
                                  getComputedStyle(lowestCommonDenominator).overflow !==
                                      "visible";
                              const newParent = {
                                  type: "FRAME",
                                  clipsContent: !!overflowHidden,
                                  ref: lowestCommonDenominator,
                                  x: lcdRect.left,
                                  y: lcdRect.top,
                                  width: lcdRect.width,
                                  height: lcdRect.height,
                                  backgrounds: [],
                                  children: newChildren
                              };
                              refMap.set(lowestCommonDenominator, ref);
                              let firstIndex = layer.children.length - 1;
                              for (const child of newChildren) {
                                  const childIndex = layer.children.indexOf(child);
                                  if (childIndex > -1 && childIndex < firstIndex) {
                                      firstIndex = childIndex;
                                  }
                              }
                              layer.children.splice(firstIndex, 0, newParent);
                              for (const child of newChildren) {
                                  const index = layer.children.indexOf(child);
                                  if (index > -1) {
                                      layer.children.splice(index, 1);
                                  }
                              }
                              secondUpdate = true;
                          }
                      }
                  }
              }
          });
      }
      // Update all positions
      traverse(root, layer => {
          if (layer.type === "FRAME" || layer.type === "GROUP") {
              const { x, y } = layer;
              if (x || y) {
                  traverse(layer, child => {
                      if (child === layer) {
                          return;
                      }
                      child.x = child.x - x;
                      child.y = child.y - y;
                  });
              }
          }
      });
  }
  function removeRefs(layers) {
      layers.concat([root]).forEach(layer => {
          traverse(layer, child => {
              delete child.ref;
          });
      });
  }
  function addConstraints(layers) {
      layers.concat([root]).forEach(layer => {
          traverse(layer, child => {
              if (child.type === "SVG") {
                  child.constraints = {
                      horizontal: "CENTER",
                      vertical: "MIN"
                  };
              }
              else {
                  let hasFixedWidth = false;
                  const ref = layer.ref;
                  if (ref) {
                      // TODO: also if is shrink width and padding and text align center hm
                      const el = ref instanceof Element ? ref : ref.parentElement;
                      if (el instanceof HTMLElement) {
                          const currentStyleDisplay = el.style.display;
                          el.style.display = "none";
                          const computedWidth = getComputedStyle(el).width;
                          el.style.display = currentStyleDisplay;
                          if (computedWidth && computedWidth.match(/^[\d\.]+px$/)) {
                              hasFixedWidth = true;
                          }
                      }
                  }
                  child.constraints = {
                      horizontal: hasFixedWidth ? "CENTER" : "SCALE",
                      vertical: "MIN"
                  };
              }
          });
      });
  }
  // TODO: arg can be passed in
  const MAKE_TREE = useFrames;
  if (MAKE_TREE) {
      root.children = layers.slice(1);
      makeTree();
      addConstraints([root]);
      removeRefs([root]);
      if (time) {
          console.info("\n");
          console.timeEnd("Parse dom");
      }
      return [root];
  }
  removeRefs(layers);
  if (time) {
      console.info("\n");
      console.timeEnd("Parse dom");
  }
  return layers;
}
