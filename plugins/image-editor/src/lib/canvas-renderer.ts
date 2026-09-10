import type {
  AnnotationElement,
  ArrowElement,
  CircleElement,
  HighlighterElement,
  LineElement,
  MosaicBrushElement,
  MosaicElement,
  PenElement,
  Point,
  RectElement,
  StepElement,
  TextElement
} from '../types/editor';

/**
 * 绘制智能双翼指示箭头 (媲美 CleanShot/Snipaste 现代风格)
 */
export function drawArrow(ctx: CanvasRenderingContext2D, el: ArrowElement): void {
  const { startX, startY, endX, endY, strokeColor, strokeWidth } = el;
  const dx = endX - startX;
  const dy = endY - startY;
  const distance = Math.hypot(dx, dy);
  if (distance < 5) return;

  const angle = Math.atan2(dy, dx);
  const headLen = Math.max(strokeWidth * 3.8, 14);
  const headAngle = Math.PI / 6; // 30度

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. 绘制箭头尾杆 (缩短避免穿透箭尖)
  const shaftEndX = endX - Math.cos(angle) * (headLen * 0.7);
  const shaftEndY = endY - Math.sin(angle) * (headLen * 0.7);

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(shaftEndX, shaftEndY);
  ctx.stroke();

  // 2. 绘制箭头头部尖角多边形
  const leftX = endX - headLen * Math.cos(angle - headAngle);
  const leftY = endY - headLen * Math.sin(angle - headAngle);
  const rightX = endX - headLen * Math.cos(angle + headAngle);
  const rightY = endY - headLen * Math.sin(angle + headAngle);
  const indentX = endX - headLen * 0.75 * Math.cos(angle);
  const indentY = endY - headLen * 0.75 * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(indentX, indentY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 绘制矩形 / 圆角矩形
 */
export function drawRect(ctx: CanvasRenderingContext2D, el: RectElement): void {
  const { x, y, width, height, strokeColor, strokeWidth, fill, radius = 6 } = el;
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const rx = width < 0 ? x + width : x;
  const ry = height < 0 ? y + height : y;
  const rw = Math.abs(width);
  const rh = Math.abs(height);

  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(rx, ry, rw, rh, Math.min(radius, rw / 2, rh / 2));
  } else {
    ctx.rect(rx, ry, rw, rh);
  }

  if (fill) {
    ctx.fillStyle = el.fillColor || `${strokeColor}40`; // 默认半透明填充
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制椭圆 / 正圆
 */
export function drawCircle(ctx: CanvasRenderingContext2D, el: CircleElement): void {
  const { x, y, radiusX, radiusY, strokeColor, strokeWidth, fill } = el;
  const rx = Math.abs(radiusX);
  const ry = Math.abs(radiusY);
  if (rx < 1 || ry < 1) return;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;

  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI);

  if (fill) {
    ctx.fillStyle = el.fillColor || `${strokeColor}40`;
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制直线
 */
export function drawLine(ctx: CanvasRenderingContext2D, el: LineElement): void {
  const { startX, startY, endX, endY, strokeColor, strokeWidth } = el;
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制平滑贝塞尔自由手绘笔迹
 */
export function drawPen(ctx: CanvasRenderingContext2D, el: PenElement): void {
  const { points, strokeColor, strokeWidth } = el;
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const xc = (points[i].x + points[i + 1].x) / 2;
      const yc = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制半透明荧光笔
 */
export function drawHighlighter(ctx: CanvasRenderingContext2D, el: HighlighterElement): void {
  const { points, strokeColor, strokeWidth } = el;
  if (points.length < 2) return;

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth * 2.5; // 荧光笔通常较宽
  ctx.lineCap = 'square';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制步骤序号标记气泡 ① ② ③ ...
 */
export function drawStep(ctx: CanvasRenderingContext2D, el: StepElement): void {
  const { x, y, stepNumber, color, size = 18 } = el;
  ctx.save();

  // 1. 阴影
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  // 2. 主圆形背景
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 3. 重置阴影绘制白色外描边
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 4. 白色居中文字
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(size * 1.1)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stepNumber.toString(), x, y + 1);

  ctx.restore();
}

/**
 * 绘制带暗色背景标签的文字标注
 */
export function drawText(ctx: CanvasRenderingContext2D, el: TextElement): void {
  const { x, y, text, color, fontSize = 20, bgColor = 'rgba(15, 23, 42, 0.85)' } = el;
  if (!text) return;

  ctx.save();
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const metrics = ctx.measureText(text);
  const paddingX = 8;
  const paddingY = 4;
  const textWidth = metrics.width;
  const textHeight = fontSize * 1.25;

  // 背景标签
  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    const bx = x - paddingX;
    const by = y - paddingY;
    const bw = textWidth + paddingX * 2;
    const bh = textHeight + paddingY * 2;
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(bx, by, bw, bh, 6);
    } else {
      ctx.rect(bx, by, bw, bh);
    }
    ctx.fill();

    // 细边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 文本内容
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/**
 * 像素化区域马赛克计算与绘制
 */
export function drawMosaic(
  ctx: CanvasRenderingContext2D,
  baseCtx: CanvasRenderingContext2D,
  el: MosaicElement,
  canvasWidth: number,
  canvasHeight: number
): void {
  const { x, y, width, height, blockSize = 14 } = el;
  const rx = Math.max(0, Math.floor(width < 0 ? x + width : x));
  const ry = Math.max(0, Math.floor(height < 0 ? y + height : y));
  const rw = Math.min(canvasWidth - rx, Math.abs(Math.floor(width)));
  const rh = Math.min(canvasHeight - ry, Math.abs(Math.floor(height)));

  if (rw <= 0 || rh <= 0) return;

  try {
    const imgData = baseCtx.getImageData(rx, ry, rw, rh);
    const data = imgData.data;

    ctx.save();
    for (let by = 0; by < rh; by += blockSize) {
      for (let bx = 0; bx < rw; bx += blockSize) {
        const curBlockW = Math.min(blockSize, rw - bx);
        const curBlockH = Math.min(blockSize, rh - by);

        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let count = 0;

        for (let py = 0; py < curBlockH; py++) {
          for (let px = 0; px < curBlockW; px++) {
            const index = ((by + py) * rw + (bx + px)) * 4;
            totalR += data[index];
            totalG += data[index + 1];
            totalB += data[index + 2];
            count++;
          }
        }

        if (count > 0) {
          const avgR = Math.round(totalR / count);
          const avgG = Math.round(totalG / count);
          const avgB = Math.round(totalB / count);
          ctx.fillStyle = `rgb(${avgR}, ${avgG}, ${avgB})`;
          ctx.fillRect(rx + bx, ry + by, curBlockW, curBlockH);
        }
      }
    }
    ctx.restore();
  } catch (err) {
    console.warn('[CanvasRenderer] 绘制马赛克失败:', err);
  }
}

/**
 * 绘制涂抹马赛克
 */
export function drawMosaicBrush(
  ctx: CanvasRenderingContext2D,
  baseCtx: CanvasRenderingContext2D,
  el: MosaicBrushElement,
  canvasWidth: number,
  canvasHeight: number
): void {
  const { points, brushSize = 28, blockSize = 12 } = el;
  if (points.length === 0) return;

  for (const pt of points) {
    const fakeEl: MosaicElement = {
      id: el.id,
      type: 'mosaic',
      x: pt.x - brushSize / 2,
      y: pt.y - brushSize / 2,
      width: brushSize,
      height: brushSize,
      blockSize
    };
    drawMosaic(ctx, baseCtx, fakeEl, canvasWidth, canvasHeight);
  }
}

/**
 * 完整帧多图层无损实时渲染
 */
export function renderAllElements(
  targetCanvas: HTMLCanvasElement,
  baseCanvas: HTMLCanvasElement,
  elements: AnnotationElement[],
  activeElement?: AnnotationElement | null
): void {
  const ctx = targetCanvas.getContext('2d');
  const baseCtx = baseCanvas.getContext('2d');
  if (!ctx || !baseCtx) return;

  const w = targetCanvas.width;
  const h = targetCanvas.height;

  // 1. 清空画布
  ctx.clearRect(0, 0, w, h);

  // 2. 绘制基底图像
  ctx.drawImage(baseCanvas, 0, 0, w, h);

  // 3. 顺序绘制所有已提交的元素
  for (const el of elements) {
    renderSingleElement(ctx, baseCtx, el, w, h);
  }

  // 4. 绘制当前正在交互拖拽预览的活跃元素
  if (activeElement) {
    renderSingleElement(ctx, baseCtx, activeElement, w, h);
  }
}

function renderSingleElement(
  ctx: CanvasRenderingContext2D,
  baseCtx: CanvasRenderingContext2D,
  el: AnnotationElement,
  w: number,
  h: number
): void {
  switch (el.type) {
    case 'rect':
      drawRect(ctx, el);
      break;
    case 'circle':
      drawCircle(ctx, el);
      break;
    case 'arrow':
      drawArrow(ctx, el);
      break;
    case 'line':
      drawLine(ctx, el);
      break;
    case 'pen':
      drawPen(ctx, el);
      break;
    case 'highlighter':
      drawHighlighter(ctx, el);
      break;
    case 'step':
      drawStep(ctx, el);
      break;
    case 'text':
      drawText(ctx, el);
      break;
    case 'mosaic':
      drawMosaic(ctx, baseCtx, el, w, h);
      break;
    case 'mosaic-brush':
      drawMosaicBrush(ctx, baseCtx, el, w, h);
      break;
  }
}
